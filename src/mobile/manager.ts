/** Standard-library adapter for Android SDK tools and Xcode simctl. */
export const mobileManager = String.raw`import fcntl, json, os, platform, re, shlex, socket, subprocess, sys, time
from pathlib import Path

cfg = json.loads(sys.argv[1])
action = sys.argv[2]
extra = sys.argv[3:]
base = Path(cfg['base'])
marker = base / 'owner.json'
env = dict(os.environ)
if cfg.get('developerDir'):
    env['DEVELOPER_DIR'] = cfg['developerDir']

def run(args, capture=False, input=None, timeout=None):
    result = subprocess.run([str(a) for a in args], env=env, text=True, input=input,
        stdin=subprocess.DEVNULL if input is None else None, capture_output=capture, timeout=timeout)
    if result.returncode:
        if capture:
            print(result.stderr, file=sys.stderr, end='')
        raise subprocess.CalledProcessError(result.returncode, result.args)
    return result.stdout if capture else None

def saved():
    if not marker.exists():
        return None
    data = json.loads(marker.read_text())
    if data.get('owner') != cfg['owner']:
        raise ValueError('Device belongs to another Workstation configuration')
    return data

def save(data):
    temporary = base / 'owner.tmp'
    temporary.write_text(json.dumps(data))
    temporary.replace(marker)

def claim(identity):
    data = saved()
    if data and data['identity'] != identity:
        raise ValueError('Device image, runtime or hardware changed; explicitly destroy it before recreating')
    if data is None:
        data = {'owner': cfg['owner'], 'identity': identity}
        save(data)
    return data

def sim(*args, capture=False, timeout=None):
    return run(['xcrun', 'simctl', *args], capture=capture, timeout=timeout)

def ios_info(data):
    devices = json.loads(sim('list', 'devices', '--json', capture=True))['devices']
    matches = [(runtime, device) for runtime, group in devices.items() for device in group
        if device.get('name') == cfg['runtimeName'] or (data and device.get('udid') == data.get('udid'))]
    if len(matches) > 1:
        raise ValueError('Ambiguous simulator identity')
    if not matches:
        return None
    runtime, device = matches[0]
    if not data or (data.get('udid') and data['udid'] != device['udid']) or device['name'] != cfg['runtimeName']:
        raise ValueError('Refusing to adopt an existing simulator')
    if [runtime, device['deviceTypeIdentifier']] != data['identity']:
        raise ValueError('Simulator identity was externally modified')
    return device

def ios_setup():
    identity = [cfg['runtime'], cfg['deviceType']]
    data = saved()
    info = ios_info(data)
    if data and data['identity'] != identity:
        raise ValueError('Simulator runtime or hardware changed; explicitly destroy it before recreating')
    runtimes = json.loads(sim('list', 'runtimes', '--json', capture=True))['runtimes']
    if not any(r.get('identifier') == cfg['runtime'] and r.get('isAvailable') for r in runtimes):
        version = cfg.get('downloadRuntimeVersion')
        if not version:
            raise ValueError('Install the selected iOS runtime in Xcode or set downloadRuntimeVersion')
        run(['xcodebuild', '-downloadPlatform', 'iOS', '-buildVersion', version])
        runtimes = json.loads(sim('list', 'runtimes', '--json', capture=True))['runtimes']
        if not any(r.get('identifier') == cfg['runtime'] and r.get('isAvailable') for r in runtimes):
            raise ValueError('Downloaded runtime is not available in the selected Xcode')
    data = claim(identity)
    if not info:
        udid = sim('create', cfg['runtimeName'], cfg['deviceType'], cfg['runtime'], capture=True).strip()
        if not re.fullmatch(r'[A-Fa-f0-9-]{36}', udid):
            raise ValueError('simctl returned an invalid device identifier')
        data['udid'] = udid
        save(data)
    elif not data.get('udid'):
        data['udid'] = info['udid']
        save(data)
    info = ios_info(data)
    if not info or not info.get('isAvailable'):
        raise ValueError('Simulator is unavailable after setup')
    return info

def ios_operation():
    if action in ('setup', 'up'):
        info = ios_setup()
        if action == 'up':
            if info['state'] == 'Shutdown':
                sim('boot', info['udid'])
            elif info['state'] != 'Booted':
                raise ValueError('Simulator is transitioning; wait before booting')
            sim('bootstatus', info['udid'], timeout=cfg['timeout'])
        return 0
    data = saved()
    info = ios_info(data)
    if action in ('check', 'status'):
        ready = bool(info and info.get('isAvailable') and data['identity'] == [cfg['runtime'], cfg['deviceType']])
        if action == 'status':
            print(json.dumps(info or {'state': 'Absent'}))
            ready = ready and info['state'] == 'Booted'
        return 0 if ready else 1
    if action in ('stop', 'destroy'):
        if info:
            if info['state'] == 'Booted':
                sim('shutdown', info['udid'], timeout=cfg['timeout'])
            elif info['state'] != 'Shutdown':
                raise ValueError('Simulator is transitioning; wait before stopping or deleting')
            if action == 'destroy':
                sim('delete', info['udid'])
        if action == 'destroy' and data:
            marker.unlink()
        return 0
    if not info or info['state'] != 'Booted':
        raise ValueError('Simulator is not booted; invoke its up task first')
    if action == 'install':
        sim('install', info['udid'], str(Path(extra[0]).resolve()))
    else:
        sim('spawn', info['udid'], *extra)
    return 0

sdk = Path(cfg.get('sdkRoot', '.'))
tools = sdk / 'cmdline-tools' / cfg.get('toolsVersion', 'latest') / 'bin'
adb = sdk / 'platform-tools/adb'
emulator = sdk / 'emulator/emulator'
avdhome = base / 'avd'
avd = avdhome / (cfg['runtimeName'] + '.avd')
if cfg['backend'] == 'android':
    env.update(ANDROID_HOME=str(sdk), ANDROID_SDK_ROOT=str(sdk), ANDROID_AVD_HOME=str(avdhome))


def android_identity():
    return [str(sdk), cfg['systemImage'], cfg['device'], cfg['port']]

def properties():
    file = avd / 'config.ini'
    if not file.exists():
        return {}
    return dict(line.split('=', 1) for line in file.read_text().splitlines() if '=' in line and not line.startswith('#'))

def android_validate_paths(data):
    ini = avdhome / (cfg['runtimeName'] + '.ini')
    if avdhome.is_symlink() or avd.is_symlink() or ini.is_symlink() or (avd / 'config.ini').is_symlink():
        raise ValueError('Refusing redirected AVD paths')
    if not data and (avd.exists() or ini.exists()):
        raise ValueError('Refusing to adopt an existing AVD')
    if ini.exists():
        values = dict(line.split('=', 1) for line in ini.read_text().splitlines() if '=' in line)
        if values.get('path') != str(avd):
            raise ValueError('AVD path was externally modified; refusing to operate on it')

def android_ready(data):
    android_validate_paths(data)
    values = properties()
    return bool(data and data['identity'] == android_identity() and values
        and values.get('hw.cpu.ncore') == str(cfg['cpus']) and values.get('hw.ramSize') == str(cfg['memoryMiB'])
        and values.get('image.sysdir.1', '').rstrip('/') == '/'.join(cfg['systemImage'].split(';'))
        and adb.is_file() and emulator.is_file() and (sdk.joinpath(*cfg['systemImage'].split(';')) / 'source.properties').is_file())

def connected():
    listing = run([adb, 'devices'], capture=True, timeout=15)
    serial = 'emulator-' + str(cfg['port'])
    entries = dict(line.split()[:2] for line in listing.splitlines()[1:] if len(line.split()) >= 2)
    if serial not in entries:
        return None
    if entries[serial] != 'device':
        raise ValueError('Emulator port is offline or unavailable; wait for it to settle')
    name = run([adb, '-s', serial, 'emu', 'avd', 'name'], capture=True, timeout=15).splitlines()[0]
    if name != cfg['runtimeName']:
        raise ValueError('Selected emulator port belongs to another AVD')
    return serial

def android_setup():
    data = saved()
    if data and data['identity'] != android_identity():
        raise ValueError('Android image or hardware changed; explicitly destroy it before recreating')
    if not data and (avd.exists() or (avdhome / (cfg['runtimeName'] + '.ini')).exists()):
        raise ValueError('Refusing to adopt an existing AVD')
    if android_ready(data):
        return
    expected_arch = 'arm64-v8a' if platform.machine() in ('arm64', 'aarch64') else 'x86_64'
    if cfg['systemImage'].split(';')[-1] != expected_arch:
        raise ValueError('Android system image must match the host CPU architecture')
    for tool in ('sdkmanager', 'avdmanager'):
        if not (tools / tool).is_file():
            raise ValueError('Install Android command-line tools and Java first; missing ' + str(tools / tool))
    if adb.is_file() and avd.exists() and connected():
        raise ValueError('Stop the emulator before changing its configuration')
    packages = ['platform-tools', 'emulator', cfg['systemImage']]
    missing = [p for p in packages if not (sdk.joinpath(*p.split(';')) / 'source.properties').is_file()]
    if missing:
        with (sdk / '.workstation-packages.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            missing = [p for p in packages if not (sdk.joinpath(*p.split(';')) / 'source.properties').is_file()]
            if missing:
                if cfg.get('acceptLicenses'):
                    run([tools / 'sdkmanager', '--sdk_root=' + str(sdk), '--licenses'], input='y\n' * 1000)
                run([tools / 'sdkmanager', '--sdk_root=' + str(sdk), *missing])
            if any(not (sdk.joinpath(*p.split(';')) / 'source.properties').is_file() for p in packages):
                raise ValueError('SDK packages were not installed; review SDK licenses and download errors')
    claim(android_identity())
    avdhome.mkdir(parents=True, exist_ok=True)
    if not avd.exists():
        run([tools / 'avdmanager', 'create', 'avd', '--name', cfg['runtimeName'], '--package', cfg['systemImage'], '--device', cfg['device'], '--path', avd], input='no\n')
    values = properties()
    if not values:
        raise ValueError('AVD creation is incomplete; inspect it before explicitly destroying and retrying')
    values['hw.cpu.ncore'] = str(cfg['cpus'])
    values['hw.ramSize'] = str(cfg['memoryMiB'])
    temporary = avd / 'config.ini.workstation'
    temporary.write_text(''.join(k + '=' + v + '\n' for k, v in values.items()))
    temporary.replace(avd / 'config.ini')
    if not android_ready(saved()):
        raise ValueError('AVD does not match the requested system image or tools')

def android_stop():
    serial = connected() if adb.is_file() else None
    if serial:
        run([adb, '-s', serial, 'emu', 'kill'], timeout=15)
        deadline = time.monotonic() + cfg['timeout']
        while time.monotonic() < deadline:
            listing = run([adb, 'devices'], capture=True, timeout=15)
            if not any(line.split() and line.split()[0] == serial for line in listing.splitlines()[1:]):
                return
            time.sleep(0.5)
        raise ValueError('Emulator shutdown timed out; retained its data')

def android_operation():
    data = saved()
    android_validate_paths(data)
    if data and action not in ('check', 'setup', 'status') and data['identity'] != android_identity():
        raise ValueError('Restore the original SDK, image, device and port settings before operating on this AVD')
    if action == 'check':
        return 0 if android_ready(data) else 1
    if action in ('setup', 'up'):
        android_setup()
        if action == 'setup':
            return 0
        serial = connected()
        process = None
        if not serial:
            for port in (cfg['port'], cfg['port'] + 1):
                with socket.socket() as probe:
                    probe.bind(('127.0.0.1', port))
            log = base / 'emulator.log'
            with log.open('a') as output:
                process = subprocess.Popen([str(emulator), '-avd', cfg['runtimeName'], '-port', str(cfg['port']),
                    '-no-snapshot', *(['-no-window', '-no-audio'] if cfg.get('headless') else [])],
                    env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True)
        deadline = time.monotonic() + cfg['timeout']
        serial = 'emulator-' + str(cfg['port'])
        while time.monotonic() < deadline:
            if process and process.poll() is not None:
                raise ValueError('Emulator exited during boot; inspect ' + str(base / 'emulator.log'))
            # During boot adb may report offline; bounded readiness polling is expected.
            listing = run([adb, 'devices'], capture=True, timeout=15)
            if any(line.split()[:2] == [serial, 'device'] for line in listing.splitlines()[1:]):
                connected()
                if run([adb, '-s', serial, 'shell', 'getprop sys.boot_completed'], capture=True, timeout=15).strip() == '1':
                    return 0
            time.sleep(0.5)
        raise ValueError('Emulator boot timed out; inspect emulator.log and use stop before retrying')
    if action == 'status':
        serial = connected() if data and adb.is_file() else None
        print(json.dumps({'name': cfg['runtimeName'], 'serial': serial, 'configured': android_ready(data)}))
        return 0 if serial and android_ready(data) else 1
    if not data:
        if action in ('stop', 'destroy'):
            return 0
        raise ValueError('AVD is not managed; invoke its setup task first')
    if action in ('stop', 'destroy'):
        android_stop()
        if action == 'destroy':
            if avd.exists() or (avdhome / (cfg['runtimeName'] + '.ini')).exists():
                run([tools / 'avdmanager', 'delete', 'avd', '--name', cfg['runtimeName']])
            marker.unlink()
        return 0
    serial = connected()
    if not serial:
        raise ValueError('Emulator is not running; invoke its up task first')
    if action == 'install':
        run([adb, '-s', serial, 'install', '-r', str(Path(extra[0]).resolve())])
    else:
        run([adb, '-s', serial, 'shell', shlex.join(extra)])
    return 0

def main():
    if action not in ('check', 'setup', 'up', 'stop', 'status', 'install', 'exec', 'destroy'):
        raise ValueError('Unknown mobile operation')
    if action == 'install' and len(extra) != 1:
        raise ValueError('Pass exactly one APK or simulator .app path after --')
    if action == 'exec' and (not extra or extra[0].startswith('-')):
        raise ValueError('Pass a device executable and its arguments after --')
    if action not in ('install', 'exec') and extra:
        raise ValueError('Unexpected lifecycle arguments')
    operation = ios_operation if cfg['backend'] == 'ios' else android_operation
    if action in ('check', 'status'):
        return operation()
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (base / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return operation()

try:
    sys.exit(main())
except subprocess.CalledProcessError as error:
    sys.exit(error.returncode if error.returncode > 0 else 1)
except Exception as error:
    print('Mobile device: ' + str(error), file=sys.stderr)
    sys.exit(1)
`;
