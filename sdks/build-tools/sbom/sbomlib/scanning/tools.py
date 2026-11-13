"""Install pinned scanners and verify every downloaded byte."""
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
from urllib.request import urlopen


def read(path):
    return json.loads(Path(path).read_text())



def write(path, data):
    Path(path).write_text(json.dumps(data, indent=2, sort_keys=True) + '\n')



def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()



def fetch(pin, cache):
    path = cache / pin['sha256']
    if not path.exists():
        url = pin['url']
        if url.startswith('https://github.com/') and '/blob/' in url:
            url = url.replace('https://github.com/', 'https://raw.githubusercontent.com/', 1).replace('/blob/', '/', 1)
        with tempfile.NamedTemporaryFile(dir=cache, delete=False) as tmp:
            temporary = Path(tmp.name)
        try:
            with urlopen(url, timeout=60) as stream, temporary.open('wb') as out:
                shutil.copyfileobj(stream, out)
            if sha(temporary) != pin['sha256']:
                raise ValueError(f'Download checksum mismatch: {url}')
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    if sha(path) != pin['sha256']:
        raise ValueError(f'Cached download checksum mismatch: {path}')
    return path



def install(name, pins, cache, destination):
    arch = {'x86_64': 'amd64', 'aarch64': 'arm64', 'arm64': 'arm64'}[platform.machine()]
    system = platform.system().lower() + '_' + arch
    rule = pins[name]
    archive = fetch({'url': rule['url'].format(version=rule['version'], platform=system),
                     'sha256': rule['sha256'][system]}, cache)
    binary = destination / name
    if name == 'grype':
        with tarfile.open(archive) as tar:
            member = tar.getmember('grype')
            if not member.isfile():
                raise ValueError('Expected a regular Grype executable')
            with tar.extractfile(member) as source, binary.open('wb') as out:
                shutil.copyfileobj(source, out)
    else:
        shutil.copyfile(archive, binary)
    binary.chmod(0o755)
    return str(binary)



def run(command, output, log, env):
    with Path(output).open('w') as stdout, Path(log).open('w') as stderr:
        return subprocess.run(command, stdout=stdout, stderr=stderr, env=env, timeout=600).returncode
