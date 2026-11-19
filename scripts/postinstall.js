// scripts/postinstall.js
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('Compiling Bluetooth module for Electron...');

const moduleDir = path.join(rootDir, 'node_modules', 'bluetooth-serial-port');
if (!fs.existsSync(moduleDir)) {
    console.error('ERROR: bluetooth-serial-port not found in node_modules.');
    process.exit(1);
}

// Находим локальный node-gyp
const nodeGypPath = path.join(rootDir, 'node_modules', 'node-gyp-build', 'node-gyp-build.js');
if (!fs.existsSync(nodeGypPath)) {
    console.error('ERROR: node-gyp not found in node_modules.');
    process.exit(1);
}

// Read .npmrc for the Python path used by node-gyp.
let pythonPath = '';
try {
    const npmrc = fs.readFileSync(path.join(rootDir, '.npmrc'), 'utf8');
    const match = npmrc.match(/python=(.*)/);
    if (match) pythonPath = match[1].trim();
} catch {
    console.warn('WARNING: .npmrc not found or unreadable. Will use system Python.');
}

const env = { ...process.env };
if (pythonPath) env.PYTHON = pythonPath;

function replaceSource(relativePath, original, replacement, expectedOccurrences = 1, previousReplacement = null) {
    const sourcePath = path.join(moduleDir, relativePath);
    let source = fs.readFileSync(sourcePath, 'utf8');
    const occurrences = source.split(original).length - 1;

    if (source.includes(replacement)) return;
    if (occurrences === 0 && previousReplacement && source.includes(previousReplacement)) {
        source = source.split(previousReplacement).join(replacement);
        fs.writeFileSync(sourcePath, source);
        return;
    }
    if (occurrences !== expectedOccurrences) {
        throw new Error(`Unexpected Bluetooth source layout in ${relativePath}.`);
    }

    fs.writeFileSync(sourcePath, source.split(original).join(replacement));
}

function ensureWindowsUtf8NameHelper() {
    const sourcePath = path.join(moduleDir, 'src', 'windows', 'DeviceINQ.cc');
    let source = fs.readFileSync(sourcePath, 'utf8');
    const helperPattern = /^static std::string AnsiToUtf8\(const char\* value\) \{[\s\S]*?^\}\r?\n?/gm;
    const helper = `static std::string AnsiToUtf8(const char* value) {
    if (value == nullptr) return std::string();

    const int wideLength = MultiByteToWideChar(CP_ACP, 0, value, -1, nullptr, 0);
    if (wideLength == 0) return std::string(value);

    std::wstring wide(static_cast<size_t>(wideLength), L'\\0');
    if (MultiByteToWideChar(CP_ACP, 0, value, -1, &wide[0], wideLength) == 0) {
        return std::string(value);
    }

    const int utf8Length = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, nullptr, 0, nullptr, nullptr);
    if (utf8Length == 0) return std::string(value);

    std::string utf8(static_cast<size_t>(utf8Length), '\\0');
    if (WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, &utf8[0], utf8Length, nullptr, nullptr) == 0) {
        return std::string(value);
    }

    utf8.resize(static_cast<size_t>(utf8Length - 1));
    return utf8;
}
`;

    source = source.replace(/^#include <string>\r?\n?/gm, '');
    source = source.replace(helperPattern, '');

    const includeAnchor = '#include <string.h>';
    const namespaceAnchor = 'using namespace v8;';
    if (source.split(includeAnchor).length !== 2 || source.split(namespaceAnchor).length !== 2) {
        throw new Error('Unexpected Bluetooth source layout in src/windows/DeviceINQ.cc.');
    }

    source = source.replace(includeAnchor, `${includeAnchor}\n#include <string>`);
    source = source.replace(namespaceAnchor, `${namespaceAnchor}\n\n${helper}`);
    fs.writeFileSync(sourcePath, source);
}

try {
    // Adapt upstream V8 calls, buffer sizes, and Windows ANSI device names.
    replaceSource(
        path.join('src', 'windows', 'DeviceINQ.cc'),
        '    Isolate *isolate = target->GetIsolate();\n    Local<Context> ctx = isolate->GetCurrentContext();',
        '    Local<Context> ctx = Nan::GetCurrentContext();'
    );
    replaceSource(
        path.join('src', 'windows', 'DeviceINQ.cc'),
        'String::Utf8Value address(cb->GetIsolate(), info[0]);',
        'String::Utf8Value address(info.GetIsolate(), info[0]);'
    );
    replaceSource(
        path.join('src', 'windows', 'BTSerialPortBinding.cc'),
        '    Isolate *isolate = target->GetIsolate();\n    Local<Context> ctx = isolate->GetCurrentContext();',
        '    Local<Context> ctx = Nan::GetCurrentContext();'
    );
    replaceSource(
        path.join('src', 'windows', 'DeviceINQ.cc'),
        'sscanf_s(address, "(" "%18[^)]" ")", strippedAddress)',
        'sscanf_s(address, "(" "%18[^)]" ")", strippedAddress, static_cast<unsigned int>(_countof(strippedAddress)))',
        3,
        'sscanf_s(address, "(" "%18[^)]" ")", strippedAddress, _countof(strippedAddress))'
    );
    ensureWindowsUtf8NameHelper();
    replaceSource(
        path.join('src', 'DeviceINQ.h'),
        'char name[248];',
        'char name[1024];'
    );
    replaceSource(
        path.join('src', 'windows', 'DeviceINQ.cc'),
        'strcpy(max_bt_device_list[num_rsp].name, querySet->lpszServiceInstanceName);',
        'const std::string utf8Name = AnsiToUtf8(querySet->lpszServiceInstanceName);\n                    strcpy_s(max_bt_device_list[num_rsp].name, _countof(max_bt_device_list[num_rsp].name), utf8Name.c_str());'
    );
    replaceSource(
        path.join('src', 'windows', 'DeviceINQ.cc'),
        'Nan::Set(deviceObj, Nan::New("name").ToLocalChecked(), Nan::New(querySet->lpszServiceInstanceName).ToLocalChecked());',
        'const std::string deviceNameUtf8 = AnsiToUtf8(querySet->lpszServiceInstanceName);\n                    Nan::Set(deviceObj, Nan::New("name").ToLocalChecked(), Nan::New(deviceNameUtf8).ToLocalChecked());',
        1,
        'Nan::Set(deviceObj, Nan::New("name").ToLocalChecked(), Nan::New(AnsiToUtf8(querySet->lpszServiceInstanceName).c_str()).ToLocalChecked());'
    );
    replaceSource(
        path.join('src', 'windows', 'DeviceINQ.cc'),
        'Nan::Set(serviceObj, Nan::New("name").ToLocalChecked(), Nan::New(querySet2->lpszServiceInstanceName).ToLocalChecked());',
        'const std::string serviceNameUtf8 = AnsiToUtf8(querySet2->lpszServiceInstanceName);\n                                    Nan::Set(serviceObj, Nan::New("name").ToLocalChecked(), Nan::New(serviceNameUtf8).ToLocalChecked());',
        1,
        'Nan::Set(serviceObj, Nan::New("name").ToLocalChecked(), Nan::New(AnsiToUtf8(querySet2->lpszServiceInstanceName).c_str()).ToLocalChecked());'
    );

    const electronInstallPath = path.join(rootDir, 'node_modules', 'electron', 'install.js');
    execFileSync(process.execPath, [electronInstallPath], {
        cwd: rootDir,
        stdio: 'inherit',
        env: env,
    });

    const electronPackage = JSON.parse(
        fs.readFileSync(path.join(rootDir, 'node_modules', 'electron', 'package.json'), 'utf8')
    );
    console.log(`Building Bluetooth module for Electron ${electronPackage.version}...`);
    execFileSync(process.execPath, [
        nodeGypPath,
        'rebuild',
        `--target=${electronPackage.version}`,
        '--dist-url=https://electronjs.org/headers',
    ], {
        cwd: moduleDir,
        stdio: 'inherit',
        env: env,
    });
    console.log('Bluetooth module compiled successfully.');
} catch (err) {
    console.error('Failed to compile the Bluetooth module:', err.message);
    process.exit(1);
}
