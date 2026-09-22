/** Standard-library adapter. All runtime operations occur in tasks, never config evaluation. */
export const limaManager = String.raw`
import fcntl, hashlib, json, os, pathlib, subprocess, sys
p = json.loads(sys.argv[1])
action = sys.argv[2]
state = pathlib.Path(p['state'])
record = state / 'owner.json'
instance = pathlib.Path(p['limaHome']) / p['name']
registry = pathlib.Path(p['limaHome']) / '_disks' / p['diskName']
disk = pathlib.Path(p['path'])
env = dict(os.environ, LIMA_HOME=p['limaHome'])

def fail(message):
    raise RuntimeError(message)

def run(*args, capture=False, script=None):
    r = subprocess.run([p['cli'], *args], env=env, input=script, text=True,
                       stdout=subprocess.PIPE if capture else None, check=True)
    return r.stdout if capture else ''

def read_record():
    if not record.is_file(): fail('VM is not managed yet; run its up task')
    r = json.loads(record.read_text())
    if r['owner'] != p['owner']: fail('VM belongs to another workstation declaration')
    if r['config'] != p['config'] or r['path'] != p['path'] or r['bytes'] != p['bytes'] or r.get('storage') != p.get('storage'):
        fail('VM image, hardware or disk declaration changed; explicit migration is required')
    return r

def save(r):
    temporary = state / 'owner.tmp'
    temporary.write_text(json.dumps(r))
    temporary.replace(record)

def disk_check(r):
    if disk.is_symlink() or not disk.is_file(): fail('Managed raw disk is missing or replaced')
    s = disk.stat()
    if s.st_size != p['bytes'] or s.st_ino != r['inode']: fail('Managed raw disk size or identity changed')

def attachment_check():
    link = registry / 'datadisk'
    if not link.is_symlink() or os.readlink(link) != str(disk): fail('Lima data disk attachment changed')

def config_check(r):
    path = instance / 'lima.yaml'
    if not path.is_file(): fail('Managed Lima instance is missing')
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != r.get('yaml'): fail('Lima configuration changed outside Workstation')

def running():
    output = run('list', '--json', capture=True)
    return any(json.loads(line).get('name') == p['name'] and json.loads(line).get('status') == 'Running'
               for line in output.splitlines() if line.strip())

def guest(mode):
    run('shell', p['name'], 'sudo', '--', 'bash', '-s', '--', mode, '/dev/vdb', str(p['bytes']), script=p['guest'])

def operate():
    if action == 'up' and not record.exists():
        if instance.exists() or registry.exists() or os.path.lexists(disk):
            fail('Refusing to adopt an existing VM, disk registry or raw file')
        if not disk.parent.is_dir() or (str(disk).startswith('/Volumes/') and not os.path.ismount('/Volumes/' + disk.parts[2])):
            fail('External disk volume must already be mounted')
        # Exclusive creation: never truncate an existing file, even if another process creates it.
        with open(disk, 'xb') as f:
            os.chmod(disk, 0o600)
            f.truncate(p['bytes'])
        save(dict(owner=p['owner'], config=p['config'], path=p['path'], bytes=p['bytes'], inode=disk.stat().st_ino, storage=p.get('storage')))
    r = read_record()
    disk_check(r)
    if action == 'up':
        registry.mkdir(parents=True, exist_ok=True)
        link = registry / 'datadisk'
        if not os.path.lexists(link): link.symlink_to(disk)
        attachment_check()
        if not instance.exists():
            definition = state / 'vm.yaml'
            definition.write_text(json.dumps(p['config']))
            run('create', '--tty=false', '--name=' + p['name'], str(definition))
            r['yaml'] = hashlib.sha256((instance / 'lima.yaml').read_bytes()).hexdigest()
            save(r)
        config_check(r)
        run('start', '--tty=false', p['name'])
        guest('setup')
        guest('check')
        r['guest'] = hashlib.sha256(p['guest'].encode()).hexdigest()
        save(r)
        return
    attachment_check()
    config_check(r)
    if action == 'stop':
        run('stop', p['name'])
        return
    if not running(): fail('VM is stopped')
    if action == 'exec':
        if not sys.argv[3:]: fail('Pass a guest command after --')
        run('shell', p['name'], *sys.argv[3:])
    elif action == 'provision':
        guest('setup')
        guest('check')
        r['guest'] = hashlib.sha256(p['guest'].encode()).hexdigest()
        save(r)
    elif action in ('check', 'status'):
        if r.get('guest') != hashlib.sha256(p['guest'].encode()).hexdigest(): fail('Guest setup changed')
        guest('check')
        if action == 'status': print(p['name'] + ': running; guest storage healthy')
    else: fail('Unknown Lima action')

try:
    if action not in ('up', 'stop', 'status', 'exec', 'provision', 'check'): fail('Unknown Lima action')
    if action in ('check', 'status', 'exec'):
        operate()
    else:
        state.mkdir(parents=True, exist_ok=True)
        with open(state / 'lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            operate()
except subprocess.CalledProcessError as e:
    sys.exit(e.returncode if e.returncode > 0 else 1)
except (RuntimeError, OSError, ValueError, KeyError) as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
`;
