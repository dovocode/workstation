/** Standard-library lifecycle adapter for the msb 0.7.1 JSON and command interfaces. */
export const microsandboxManager = String.raw`import fcntl, hashlib, json, os, re, shutil, subprocess, sys, tarfile, tempfile, urllib.request
from pathlib import Path

cfg = json.loads(sys.argv[1])
action = sys.argv[2]
name = cfg['name']
environment = dict(os.environ, MSB_BACKEND='local')

def run(*args, capture=False):
    result = subprocess.run([cfg['cli'], *args], env=environment, text=True, capture_output=capture)
    if result.returncode != 0:
        if capture:
            print(result.stderr, file=sys.stderr, end='')
        raise subprocess.CalledProcessError(result.returncode, result.args)
    return result.stdout if capture else None

def inspect():
    inventory = json.loads(run('ls', '--format', 'json', capture=True))
    if not isinstance(inventory, list) or any(not isinstance(item, dict) or not isinstance(item.get('name'), str) for item in inventory):
        raise ValueError('Unsupported Microsandbox inventory schema')
    matches = [item for item in inventory if item['name'] == name]
    if not matches:
        return None
    if len(matches) != 1:
        raise ValueError('Ambiguous Microsandbox identity')
    info = json.loads(run('inspect', name, '--format', 'json', capture=True))
    if not isinstance(info, dict) or info.get('name') != name or not isinstance(info.get('config'), dict):
        raise ValueError('Unsupported Microsandbox inspection schema')
    spec = info['config']
    if not isinstance(spec.get('labels'), dict) or not isinstance(spec.get('resources'), dict) or not isinstance(spec.get('image'), dict):
        raise ValueError('Unsupported Microsandbox configuration schema')
    if spec['labels'].get('workstation.owner') != cfg['owner']:
        raise ValueError('Refusing an unowned Microsandbox VM: ' + name)
    return info

def resource_match(spec):
    resources = spec.get('resources', {})
    return resources.get('cpus') == cfg['cpus'] and resources.get('memory_mib') == cfg['memoryMiB']

def image_match(info):
    return info['config']['image'].get('Oci', {}).get('reference') == cfg['image']

def healthy(info):
    return bool(info and info.get('status') == 'Running' and image_match(info)
        and resource_match(info['config']) and isinstance(info.get('active_config'), dict)
        and resource_match(info['active_config'])
        and info['config']['labels'].get('workstation.applied') == cfg['fingerprint'])

class HttpsRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith('https://'):
            raise ValueError('Artifact redirects must use HTTPS')
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def download(artifact, directory):
    archive = directory / 'download'
    digest = hashlib.sha256()
    opener = urllib.request.build_opener(HttpsRedirect())
    with opener.open(artifact['url'], timeout=60) as source, archive.open('wb') as output:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            output.write(chunk)
    if digest.hexdigest() != artifact['sha256'].lower():
        raise ValueError('Guest Workstation checksum mismatch')
    binary = directory / 'workstation'
    if artifact.get('member'):
        with tarfile.open(archive, 'r:gz') as bundle:
            member = bundle.getmember(artifact['member'])
            if not member.isfile():
                raise ValueError('Workstation archive member must be a regular file')
            with bundle.extractfile(member) as source, binary.open('wb') as output:
                shutil.copyfileobj(source, output)
    else:
        archive.rename(binary)
    binary.chmod(0o755)
    return binary

def guest(*args, capture=False):
    return run('exec', '--no-tty', '--user', 'root', name, '--', *args, capture=capture)

def provision():
    if guest('uname', '-m', capture=True).strip() != cfg['architecture']:
        raise ValueError('Guest architecture does not match the declared Workstation binary')
    with tempfile.TemporaryDirectory(prefix='workstation-microvm-') as temporary:
        directory = Path(temporary)
        binary = download(cfg['guest']['workstation'], directory)
        config = directory / 'guest.ts'
        config.write_text(cfg['guest']['config'], encoding='utf-8')
        guest('mkdir', '-p', '/root', '/usr/local/bin')
        run('copy', str(binary), name + ':/root/workstation')
        run('copy', str(config), name + ':/root/guest.ts')
        guest('install', '-m', '0755', '/root/workstation', '/usr/local/bin/workstation')
        guest('/usr/local/bin/workstation', 'build', '--config', '/root/guest.ts')

def mutate():
    info = inspect()
    if action == 'destroy':
        if info:
            run('rm', '--force', name)
        return
    if action == 'stop':
        if info and info['status'] != 'Stopped':
            run('stop', name)
        return
    if action in ('exec', 'provision'):
        # msb exec/copy can implicitly start stopped VMs; shared tasks require an already-running VM.
        if not info or info['status'] != 'Running':
            raise ValueError('VM is not running; invoke its up task first')
        if action == 'exec':
            guest(*sys.argv[3:])
        else:
            provision()
        return
    if info and not image_match(info):
        raise ValueError('OCI image changed. Back up the VM and explicitly destroy it before recreating.')
    if healthy(info):
        return
    resources = ['--cpus', str(cfg['cpus']), '--memory', str(cfg['memoryMiB']) + 'M',
        '--max-cpus', str(cfg['cpus']), '--max-memory', str(cfg['memoryMiB']) + 'M']
    if info is None:
        run('create', '--name', name, '--label', 'workstation.owner=' + cfg['owner'], *resources, cfg['image'])
    else:
        if info['status'] not in ('Running', 'Stopped', 'Crashed'):
            raise ValueError('Unsupported VM state: ' + str(info['status']))
        if not resource_match(info['config']) or (isinstance(info.get('active_config'), dict) and not resource_match(info['active_config'])):
            if info['status'] == 'Running':
                run('stop', name)
            run('modify', name, *resources, '--next-start')
            run('start', name)
        elif info['status'] != 'Running':
            run('start', name)
    current = inspect()
    if not current or current['status'] != 'Running' or not resource_match(current['config']):
        raise ValueError('Microsandbox did not reach the requested running configuration')
    provision()
    run('modify', name, '--label', 'workstation.applied=' + cfg['fingerprint'])
    if not healthy(inspect()):
        raise ValueError('Microsandbox verification failed after provisioning')

def main():
    if action not in ('check', 'status', 'up', 'stop', 'destroy', 'provision', 'exec'):
        raise ValueError('Unknown microVM operation')
    if action != 'exec' and len(sys.argv) != 3:
        raise ValueError('This lifecycle task does not accept extra arguments')
    if action == 'exec' and len(sys.argv) == 3:
        raise ValueError('Pass a guest command after --')
    version = run('--version', capture=True)
    match = re.search(r'\b(\d+)\.(\d+)\.(\d+)\b', version)
    if not match or tuple(map(int, match.groups())) < (0, 7, 1):
        raise ValueError('Managed microVMs require Microsandbox 0.7.1 or newer')
    if action in ('check', 'status'):
        return 0 if healthy(inspect()) else 1
    lock = Path(cfg['lock'])
    lock.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with lock.open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        mutate()
    return 0

try:
    sys.exit(main())
except subprocess.CalledProcessError as error:
    sys.exit(error.returncode if error.returncode > 0 else 1)
except Exception as error:
    print('Microsandbox: ' + str(error), file=sys.stderr)
    sys.exit(1)
`;
