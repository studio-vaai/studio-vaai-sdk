import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from sbomlib.release import npm


class RegistryPublicationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.output = Path(self.directory.name)
        self.entry = {
            'name': '@studio-vaai/example', 'version': '1.0.0',
            'integrity': 'sha512-expected', 'archive': 'package.tgz',
        }
        (self.output / 'package.tgz').write_bytes(b'prepared package')
        (self.output / 'release.json').write_text(json.dumps({'packages': [self.entry]}))

    def result(self):
        return json.loads((self.output / 'publication.json').read_text())['packages'][0]

    @patch.object(npm.time, 'sleep')
    @patch.object(npm.subprocess, 'run')
    @patch.object(npm, 'registry_version')
    def test_waits_for_registry_visibility_without_republishing(self, registry, publish, sleep):
        registry.side_effect = [None, None, None, {'dist': {'integrity': 'sha512-expected'}}]
        npm.publish(self.output, dry_run=False)
        publish.assert_called_once()
        self.assertEqual(sleep.call_count, 2)
        self.assertEqual(self.result()['status'], 'published')
        self.assertEqual(self.result()['registryIntegrity'], self.entry['integrity'])

    @patch.object(npm.time, 'sleep')
    @patch.object(npm.subprocess, 'run')
    @patch.object(npm, 'registry_version', return_value=None)
    def test_missing_release_has_a_bounded_wait(self, registry, publish, sleep):
        with self.assertRaisesRegex(ValueError, 'not yet visible'):
            npm.publish(self.output, dry_run=False)
        publish.assert_called_once()
        self.assertEqual(registry.call_count, 61)  # Preflight plus sixty visibility checks.
        self.assertEqual(sleep.call_count, 59)
        self.assertEqual(self.result()['status'], 'published-awaiting-integrity')

    @patch.object(npm.time, 'sleep')
    @patch.object(npm.subprocess, 'run')
    @patch.object(npm, 'registry_version')
    def test_a_visible_hash_mismatch_still_fails(self, registry, publish, sleep):
        registry.side_effect = [None, {'dist': {'integrity': 'sha512-different'}}]
        with self.assertRaisesRegex(ValueError, 'integrity differs'):
            npm.publish(self.output, dry_run=False)
        publish.assert_called_once()
        sleep.assert_not_called()
        self.assertEqual(self.result()['registryIntegrity'], 'sha512-different')

    @patch.object(npm.subprocess, 'run')
    @patch.object(npm, 'registry_version')
    def test_uploads_all_packages_before_waiting_for_visibility(self, registry, publish):
        second = {**self.entry, 'name': '@studio-vaai/second'}
        (self.output / 'release.json').write_text(json.dumps({'packages': [self.entry, second]}))

        def metadata(entry):
            if publish.call_count == 0:
                return None
            self.assertEqual(publish.call_count, 2)
            return {'dist': {'integrity': entry['integrity']}}

        registry.side_effect = metadata
        npm.publish(self.output, dry_run=False)
        self.assertEqual(publish.call_count, 2)
        results = json.loads((self.output / 'publication.json').read_text())['packages']
        self.assertEqual([result['status'] for result in results], ['published', 'published'])

    @patch.object(npm, 'urlopen')
    def test_registry_checks_request_fresh_metadata(self, open_url):
        open_url.return_value.__enter__.return_value.read.return_value = b'{}'
        self.assertEqual(npm.registry_version(self.entry), {})
        request = open_url.call_args.args[0]
        self.assertEqual(request.get_header('Cache-control'), 'no-cache')


if __name__ == '__main__':
    unittest.main()
