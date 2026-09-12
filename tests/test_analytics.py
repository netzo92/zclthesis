"""Run with python3 -m unittest discover -s tests -p test_analytics.py."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, redirect_stderr
from datetime import datetime, timedelta, timezone
import hashlib
from http.client import HTTPConnection
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid


MODULE_PATH = Path(__file__).resolve().parents[1] / 'analytics' / 'collector.py'
SPEC = importlib.util.spec_from_file_location('analytics_collector', MODULE_PATH)
analytics = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(analytics)
TEST_TOKEN = '0123456789abcdef' * 4


def event(**overrides):
    return {'id': str(uuid.uuid4()), 'visitor': str(uuid.uuid4()),
            'session': str(uuid.uuid4()), 'type': 'pageview', 'path': '/',
            'source': 'direct'} | overrides


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.now = datetime(2026, 9, 12, 12, 0, tzinfo=timezone.utc)
        self.path = Path(self.directory.name) / 'private' / 'analytics.sqlite3'
        self.store = analytics.EventStore(self.path, clock=lambda: self.now)

    def rows(self):
        with closing(sqlite3.connect(self.path)) as db:
            db.row_factory = sqlite3.Row
            return [dict(row) for row in db.execute('SELECT * FROM events')]

    def test_private_durable_storage_hashes_and_metadata(self):
        value = event()
        self.assertTrue(self.store.record(value))
        self.assertEqual(stat.S_IMODE(self.path.parent.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        row = self.rows()[0]
        self.assertEqual(row['visitor_hash'], hashlib.sha256(value['visitor'].encode()).hexdigest())
        self.assertEqual(row['session_hash'], hashlib.sha256(value['session'].encode()).hexdigest())
        self.assertNotIn(value['visitor'], json.dumps(row))
        self.assertNotIn(value['session'], json.dumps(row))
        self.assertEqual(set(row), {'event_id', 'occurred_at', 'day', 'visitor_hash', 'session_hash',
                                    'event_type', 'path', 'source'})
        self.assertEqual(row['occurred_at'], '2026-09-12T12:00:00Z')
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
        self.now += timedelta(days=1)
        reopened = analytics.EventStore(self.path, clock=lambda: self.now)
        self.assertEqual(reopened.summary(7)['recordingStarted'], '2026-09-12T12:00:00Z')
        self.assertEqual(reopened.summary(7)['totals']['pageviews'], 1)

    def test_existing_public_directory_or_symlink_database_rejected(self):
        public = Path(self.directory.name) / 'public'
        public.mkdir(mode=0o755)
        public.chmod(0o755)
        with self.assertRaises(analytics.StoreUnavailable):
            analytics.EventStore(public / 'analytics.sqlite3')
        linked = self.path.parent / 'linked.sqlite3'
        linked.symlink_to(self.path)
        with self.assertRaises(analytics.StoreUnavailable):
            analytics.EventStore(linked)

    def test_exact_schema_uuid_and_categories(self):
        valid = event()
        for field in valid:
            bad = dict(valid)
            del bad[field]
            with self.subTest(missing=field), self.assertRaises(analytics.InvalidEvent):
                self.store.record(bad)
        invalid = [valid | {'timestamp': '2026-09-12T00:00:00Z'},
                   valid | {'url': 'https://example.com/private'}, [], None]
        invalid += [valid | {key: bad} for key in ('id', 'visitor', 'session')
                    for bad in (None, 12, str(uuid.uuid1()), valid[key].replace('-', ''), 'x' * 36)]
        invalid += [valid | {'type': 'trade'}, valid | {'source': 'https://secret.example/'},
                    valid | {'path': '/?private=1'}, valid | {'path': '/es/network'},
                    valid | {'type': 'referral_click', 'path': '/network/'},
                    valid | {'type': 'referral_click', 'path': '/es/network/'}]
        for bad in invalid:
            with self.subTest(value=bad), self.assertRaises(analytics.InvalidEvent):
                self.store.record(bad)
        self.assertEqual(self.rows(), [])
        for path in analytics.PATHS:
            self.assertTrue(self.store.record(event(path=path)))
        for source in analytics.SOURCES:
            self.assertTrue(self.store.record(event(source=source)))

    def test_deduplication_and_uppercase_uuid_normalization(self):
        value = event()
        self.assertTrue(self.store.record(value))
        upper = value | {key: value[key].upper() for key in ('id', 'visitor', 'session')}
        self.assertFalse(self.store.record(upper))
        upper['id'] = str(uuid.uuid4())
        self.assertTrue(self.store.record(upper))
        summary = self.store.summary(1)
        self.assertEqual(summary['totals']['pageviews'], 2)
        self.assertEqual(summary['totals']['visitors'], 1)
        self.assertEqual(summary['totals']['visits'], 1)

    def test_actual_visitor_and_click_caps_reset_on_utc_day(self):
        value = event()
        for _ in range(30):
            self.store.record(value | {'id': str(uuid.uuid4()), 'type': 'referral_click'})
        with self.assertRaises(analytics.RateLimited):
            self.store.record(value | {'id': str(uuid.uuid4()), 'type': 'referral_click'})
        for _ in range(270):
            self.store.record(value | {'id': str(uuid.uuid4())})
        with self.assertRaises(analytics.RateLimited):
            self.store.record(value | {'id': str(uuid.uuid4())})
        # A known delivery is still acknowledged when the visitor is capped.
        duplicate = dict(value, id=self.rows()[0]['event_id'], type='referral_click')
        self.assertFalse(self.store.record(duplicate))
        self.now += timedelta(days=1)
        self.assertTrue(self.store.record(value | {'type': 'referral_click'}))
        self.assertEqual(len(self.rows()), 301)

    def test_actual_global_daily_cap(self):
        self.assertEqual(analytics.DAILY_LIMIT, 50000)
        self.assertEqual(analytics.VISITOR_DAILY_LIMIT, 300)
        self.assertEqual(analytics.VISITOR_CLICK_LIMIT, 30)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executemany('INSERT INTO events VALUES (?,?,?,?,?,?,?,?)',
                           ((str(uuid.uuid4()), '2026-09-12T00:00:00Z', '2026-09-12',
                             'a' * 64, 'b' * 64, 'pageview', '/', 'direct') for _ in range(50000)))
        with self.assertRaises(analytics.RateLimited):
            self.store.record(event())
        self.now += timedelta(days=1)
        self.assertTrue(self.store.record(event()))

    def test_concurrent_duplicate_and_cap_transactions(self):
        value = event()
        with ThreadPoolExecutor(max_workers=16) as pool:
            self.assertEqual(sum(pool.map(self.store.record, [value] * 40)), 1)
        def record_capped(_):
            try:
                return self.store.record(value | {'id': str(uuid.uuid4())})
            except analytics.RateLimited:
                return False
        with patch.object(analytics, 'VISITOR_DAILY_LIMIT', 8):
            with ThreadPoolExecutor(max_workers=16) as pool:
                self.assertEqual(sum(pool.map(record_capped, range(40))), 7)
        self.assertEqual(len(self.rows()), 8)
        def global_capped(_):
            try:
                return self.store.record(event())
            except analytics.RateLimited:
                return False
        with patch.object(analytics, 'DAILY_LIMIT', 12):
            with ThreadPoolExecutor(max_workers=16) as pool:
                self.assertEqual(sum(pool.map(global_capped, range(30))), 4)
        self.assertEqual(len(self.rows()), 12)

    def test_summary_distinct_counts_ranges_sources_and_empty_days(self):
        visitor, session = str(uuid.uuid4()), str(uuid.uuid4())
        self.now -= timedelta(days=1)
        self.store.record(event(visitor=visitor, session=session, source='search'))
        self.store.record(event(visitor=visitor, session=session, source='search', type='referral_click'))
        self.store.record(event(visitor=visitor, session=session, source='search', type='referral_click'))
        self.now += timedelta(days=1)
        self.store.record(event(visitor=visitor, path='/es/', source='github'))
        self.store.record(event(path='/network/', source='direct'))
        summary = self.store.summary(7)
        self.assertEqual(summary['from'], '2026-09-06')
        self.assertEqual(summary['to'], '2026-09-12')
        self.assertEqual(len(summary['daily']), 7)
        self.assertEqual(summary['daily'][0]['pageviews'], 0)
        self.assertEqual(summary['totals'] | {'clickRate': None},
                         {'visitors': 2, 'visits': 3, 'pageviews': 3, 'referralClicks': 2,
                          'clickingVisits': 1, 'clickRate': None})
        self.assertAlmostEqual(summary['totals']['clickRate'], 100 / 3)
        self.assertEqual(summary['daily'][-2], {'date': '2026-09-11', 'visitors': 1,
                                               'visits': 1, 'pageviews': 1, 'referralClicks': 2})
        self.assertEqual(summary['pages'][0], {'path': '/', 'pageviews': 1, 'referralClicks': 2})
        self.assertEqual(next(row for row in summary['sources'] if row['source'] == 'search'),
                         {'source': 'search', 'visits': 1, 'referralClicks': 2})
        self.assertEqual(summary['lastEventAt'], '2026-09-12T12:00:00Z')
        self.assertEqual(self.store.summary(1)['totals']['referralClicks'], 0)
        self.assertEqual(self.store.summary(1)['totals']['pageviews'], 2)
        for days in (1, 7, 30, 90):
            self.assertEqual(len(self.store.summary(days)['daily']), days)
        for days in (0, 2, 91, True, '7'):
            with self.assertRaises(ValueError):
                self.store.summary(days)

    def test_healthy_empty_summary_and_utc_calendar(self):
        summary = self.store.summary(1)
        self.assertEqual(summary['totals'], {'visitors': 0, 'visits': 0, 'pageviews': 0,
                                             'referralClicks': 0, 'clickingVisits': 0, 'clickRate': 0})
        self.assertIsNone(summary['lastEventAt'])
        self.now = datetime(2026, 9, 12, 23, 59, tzinfo=timezone(timedelta(hours=-7)))
        self.store.record(event())
        self.assertEqual(self.store.summary(1)['to'], '2026-09-13')
        self.assertEqual(self.rows()[0]['day'], '2026-09-13')

    def test_retention_keeps_90_utc_dates_and_prunes_at_most_daily(self):
        old = event()
        self.store.record(old)
        self.now += timedelta(days=1)
        boundary = event()
        self.store.record(boundary)
        self.now += timedelta(days=89)
        self.store.record(event())
        self.assertEqual({row['event_id'] for row in self.rows()}, {boundary['id'], self.rows()[-1]['event_id']})
        self.assertNotIn(old['id'], {row['event_id'] for row in self.rows()})
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('INSERT INTO events VALUES (?,?,?,?,?,?,?,?)',
                       (old['id'], '2020-01-01T00:00:00Z', '2020-01-01', 'a' * 64, 'b' * 64,
                        'pageview', '/', 'direct'))
        self.store.prune()
        self.assertIn(old['id'], {row['event_id'] for row in self.rows()}, 'Same-day maintenance repeated')
        self.now += timedelta(days=1)
        self.store.prune()
        self.assertNotIn(old['id'], {row['event_id'] for row in self.rows()})
        self.assertNotIn(boundary['id'], {row['event_id'] for row in self.rows()})

    def test_storage_failure_is_visible_until_successful_collection(self):
        with patch.object(self.store, '_connection', side_effect=sqlite3.OperationalError('private detail')):
            with self.assertRaises(analytics.StoreUnavailable):
                self.store.record(event())
        with self.assertRaises(analytics.StoreUnavailable):
            self.store.summary(7)
        with self.assertRaises(analytics.StoreUnavailable):
            self.store.health()
        self.assertTrue(self.store.record(event()))
        self.assertEqual(self.store.summary(7)['totals']['pageviews'], 1)
        with patch.object(self.store, '_connection', side_effect=sqlite3.OperationalError('private detail')):
            with self.assertRaises(analytics.StoreUnavailable):
                self.store.summary(7)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        directory = Path(self.directory.name)
        self.store = analytics.EventStore(directory / 'analytics.sqlite3')
        for name in ('dashboard.html', 'dashboard.css', 'dashboard.js'):
            (directory / name).write_text('asset ' + name)
        self.collector = analytics.create_server(self.store, 'collector', port=0, relay_token=TEST_TOKEN)
        self.admin = analytics.create_server(self.store, 'admin', port=0, assets=directory)
        for server in (self.collector, self.admin):
            thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
            thread.start()
            self.addCleanup(self.stop_server, server, thread)

    @staticmethod
    def stop_server(server, thread):
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()

    def request(self, server, method, path, body=None, headers=None):
        connection = HTTPConnection(*server.server_address, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def post(self, value=None, **headers):
        defaults = {'Origin': 'https://zclthesis.com', 'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + TEST_TOKEN}
        defaults.update(headers)
        defaults = {key: value for key, value in defaults.items() if value is not None}
        body = json.dumps(event() if value is None else value).encode()
        return self.request(self.collector, 'POST', '/event', body, defaults)

    def admin_get(self, path='/api/summary?days=7', **headers):
        return self.request(self.admin, 'GET', path, headers={'Host': 'localhost:18091'} | headers)

    def test_loopback_bindings_and_relay_secret_required(self):
        self.assertEqual(self.collector.server_address[0], '127.0.0.1')
        self.assertEqual(self.admin.server_address[0], '127.0.0.1')
        for token in (None, '', 'a' * 63, 'g' * 64):
            with self.assertRaises(ValueError):
                analytics.create_server(self.store, 'collector', port=0, relay_token=token)
        for auth in (None, 'Bearer wrong', 'bearer ' + TEST_TOKEN, 'Bearer ' + 'é' * 64):
            with self.subTest(auth=auth):
                self.assertEqual(self.post(Authorization=auth)[0], 401)
        self.assertEqual(self.post()[0], 204)

    def test_production_startup_rejects_missing_or_invalid_token_without_creating_db(self):
        for token in (None, 'bad'):
            environment = dict(os.environ, ZCL_ANALYTICS_DB=str(Path(self.directory.name) / 'not-created.sqlite3'))
            environment.pop('ZCL_ANALYTICS_RELAY_TOKEN', None)
            if token is not None:
                environment['ZCL_ANALYTICS_RELAY_TOKEN'] = token
            result = subprocess.run([sys.executable, str(MODULE_PATH)], env=environment,
                                    capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 1)
            self.assertFalse(Path(environment['ZCL_ANALYTICS_DB']).exists())
            self.assertEqual(result.stderr, b'Analytics service unavailable.\n')

    def test_collector_origin_content_type_size_schema_and_dedup(self):
        for origin in (None, 'null', 'http://zclthesis.com', 'https://evil.example', 'https://zclthesis.com.evil.example'):
            self.assertEqual(self.post(Origin=origin)[0], 403)
        for origin in analytics.ORIGINS:
            self.assertEqual(self.post(Origin=origin)[0], 204)
        for content_type in (None, 'text/plain', 'application/x-www-form-urlencoded'):
            self.assertEqual(self.post(**{'Content-Type': content_type})[0], 415)
        self.assertEqual(self.post(**{'Content-Type': 'application/json; charset=utf-8'})[0], 204)
        headers = {'Origin': 'https://zclthesis.com', 'Authorization': 'Bearer ' + TEST_TOKEN,
                   'Content-Type': 'application/json'}
        self.assertEqual(self.request(self.collector, 'POST', '/event', b'x' * 2049, headers)[0], 413)
        for raw in (b'', b'null', b'{', b'\xff', b'{"id":"a","id":"b"}'):
            self.assertEqual(self.request(self.collector, 'POST', '/event', raw, headers)[0], 400)
        self.assertEqual(self.post(event(timestamp='not allowed'))[0], 400)
        value = event()
        self.assertEqual(self.post(value)[0], 204)
        status, response_headers, body = self.post(value)
        self.assertEqual(status, 204)
        self.assertEqual(body, b'')
        self.assertNotIn('Access-Control-Allow-Origin', response_headers)
        self.assertEqual(response_headers['Cache-Control'], 'no-store')

    def test_collector_only_event_and_caps_failure_codes(self):
        headers = {'Origin': 'https://zclthesis.com', 'Authorization': 'Bearer ' + TEST_TOKEN,
                   'Content-Type': 'application/json'}
        self.assertEqual(self.request(self.collector, 'GET', '/event', headers=headers)[0], 405)
        for path in ('/', '/health', '/event?extra=1', '/api/summary?days=7'):
            self.assertEqual(self.request(self.collector, 'POST', path, b'{}', headers)[0], 404)
        with patch.object(analytics, 'DAILY_LIMIT', 0):
            self.assertEqual(self.post()[0], 429)
        with patch.object(self.store, 'record', side_effect=analytics.StoreUnavailable('private detail')):
            status, _, body = self.post()
            self.assertEqual(status, 503)
            self.assertEqual(json.loads(body), {'error': 'collection_unavailable'})

    def test_admin_host_origin_methods_assets_and_summary_ranges(self):
        for host in ('evil.example:8091', 'localhost', '127.0.0.1:8792', 'localhost:8091.evil.example', 'localhost:443'):
            self.assertEqual(self.admin_get(Host=host)[0], 403)
        for host in analytics.ADMIN_HOSTS:
            self.assertEqual(self.admin_get('/health', Host=host)[0], 200)
            self.assertEqual(self.admin_get('/health', Host=host, Origin='http://' + host)[0], 200)
        self.assertEqual(self.admin_get('/favicon.ico')[0], 204)
        for origin in ('null', 'https://evil.example', 'http://localhost:8091', 'https://localhost:18091'):
            self.assertEqual(self.admin_get(Origin=origin)[0], 403)
        for method in ('POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'):
            self.assertEqual(self.request(self.admin, method, '/api/summary?days=7', headers={'Host': 'localhost:18091'})[0], 405)
        for path, mime in (('/', 'text/html'), ('/dashboard.html', 'text/html'),
                           ('/dashboard.css', 'text/css'), ('/dashboard.js', 'text/javascript')):
            status, headers, body = self.admin_get(path)
            self.assertEqual(status, 200)
            self.assertTrue(headers['Content-Type'].startswith(mime))
            self.assertIn(b'asset ', body)
            self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
            self.assertNotIn('Access-Control-Allow-Origin', headers)
        for path in ('/collector.py', '/data/analytics.sqlite3', '/../collector.py', '/%2e%2e/collector.py'):
            self.assertEqual(self.admin_get(path)[0], 404)
        for query in ('', '?days=2', '?days=7&days=1', '?days=7&extra=1', '?days=07', '?days=', '?other=7'):
            self.assertEqual(self.admin_get('/api/summary' + query)[0], 400)
        for days in (1, 7, 30, 90):
            status, _, body = self.admin_get('/api/summary?days=' + str(days))
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['days'], days)

    def test_admin_collection_failures_never_become_zero_summaries(self):
        self.store.collection_failed.set()
        for path in ('/health', '/api/summary?days=7'):
            status, _, body = self.admin_get(path)
            self.assertEqual(status, 503)
            self.assertEqual(json.loads(body), {'error': 'analytics_unavailable'})
            self.assertNotIn(b'totals', body)

    def test_duplicate_headers_and_chunked_body_are_rejected(self):
        base = [('Host', '127.0.0.1'), ('Origin', 'https://zclthesis.com'),
                ('Authorization', 'Bearer ' + TEST_TOKEN), ('Content-Type', 'application/json'),
                ('Content-Length', '2')]
        def raw_request(server, method, path, headers, body=b'{}'):
            request = (method + ' ' + path + ' HTTP/1.1\r\n' +
                       ''.join(key + ': ' + value + '\r\n' for key, value in headers) + '\r\n').encode() + body
            with socket.create_connection(server.server_address, timeout=5) as connection:
                connection.sendall(request)
                return int(connection.recv(4096).split(b' ', 2)[1])
        self.assertEqual(raw_request(self.collector, 'POST', '/event', base + [('Origin', 'https://evil.example')]), 403)
        self.assertEqual(raw_request(self.collector, 'POST', '/event', base + [('Authorization', 'Bearer ' + TEST_TOKEN)]), 401)
        self.assertEqual(raw_request(self.collector, 'POST', '/event', base + [('Content-Length', '2')]), 400)
        self.assertEqual(raw_request(self.collector, 'POST', '/event', base + [('Transfer-Encoding', 'chunked')]), 400)
        self.assertEqual(raw_request(self.admin, 'GET', '/health', [('Host', 'localhost:8091'), ('Host', 'evil.example')]), 403)
        self.assertEqual(raw_request(self.admin, 'GET', '/health', []), 403)

    def test_connection_limit_rejects_excess_without_spawning_thread(self):
        acquired = 0
        try:
            while self.collector.connection_slots.acquire(blocking=False):
                acquired += 1
            self.assertEqual(acquired, 32)
            with socket.create_connection(self.collector.server_address, timeout=5) as connection:
                self.assertIn(b'503 Service Unavailable', connection.recv(4096))
        finally:
            for _ in range(acquired):
                self.collector.connection_slots.release()
        self.assertEqual(self.post()[0], 204)

    def test_requests_do_not_log_visitor_headers_or_credentials(self):
        captured = io.StringIO()
        with redirect_stderr(captured):
            self.assertEqual(self.post(**{'User-Agent': 'private-browser-data'})[0], 204)
            self.assertEqual(self.post(Authorization='Bearer private-bad-token')[0], 401)
        self.assertEqual(captured.getvalue(), '')


if __name__ == '__main__':
    unittest.main()
