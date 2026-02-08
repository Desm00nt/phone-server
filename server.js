const express = require('express');
const { exec, spawn } = require('child_process');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ============================================
// НАСТРОЙКИ - ИЗМЕНИ ПОД СЕБЯ
// ============================================
const PORT = 3000;
const SESSION_SECRET = 'my-super-secret-key-change-me-2024';

// Файл с данными пользователей
const USERS_FILE = path.join(__dirname, 'users.json');

// ============================================
// ИНИЦИАЛИЗАЦИЯ ПОЛЬЗОВАТЕЛЕЙ
// ============================================
function initUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        const defaultPassword = bcrypt.hashSync('admin123', 10);
        const users = {
            admin: {
                password: defaultPassword,
                createdAt: new Date().toISOString()
            }
        };
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        console.log('========================================');
        console.log('СОЗДАН ПОЛЬЗОВАТЕЛЬ ПО УМОЛЧАНИЮ:');
        console.log('Логин: admin');
        console.log('Пароль: admin123');
        console.log('ОБЯЗАТЕЛЬНО СМЕНИ ПАРОЛЬ!');
        console.log('========================================');
    }
}

function getUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

initUsers();

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000 // 24 часа
    }
}));

// Проверка авторизации
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    res.redirect('/login');
}

// ============================================
// ЗАГРУЗКА ФАЙЛОВ (MULTER)
// ============================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = req.body.uploadPath || path.join(os.homedir(), 'uploads');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Сохраняем оригинальное имя, декодируем UTF-8
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, originalName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB макс
});

// ============================================
// СТРАНИЦА ВХОДА
// ============================================
app.get('/login', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Вход — Phone Server</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: #0a0a1a;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .login-box {
            background: #12122a;
            border: 1px solid #2a2a4a;
            border-radius: 20px;
            padding: 50px 40px;
            width: 380px;
            text-align: center;
        }
        .login-box h1 {
            color: #fff;
            margin-bottom: 8px;
            font-size: 28px;
        }
        .login-box p {
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
        }
        .login-box .icon {
            font-size: 60px;
            margin-bottom: 20px;
        }
        input {
            width: 100%;
            padding: 14px 18px;
            margin-bottom: 16px;
            background: #1a1a3a;
            border: 1px solid #2a2a4a;
            border-radius: 10px;
            color: #e0e0e0;
            font-size: 15px;
            outline: none;
            transition: border 0.3s;
        }
        input:focus { border-color: #6c63ff; }
        input::placeholder { color: #555; }
        button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #6c63ff, #5a52d5);
            color: #fff;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
            margin-top: 8px;
        }
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(108, 99, 255, 0.4);
        }
        .error {
            background: #ff525220;
            color: #ff5252;
            padding: 10px;
            border-radius: 8px;
            margin-bottom: 16px;
            font-size: 13px;
            display: none;
        }
    </style>
</head>
<body>
    <div class="login-box">
        <div class="icon">📱</div>
        <h1>Phone Server</h1>
        <p>Введите логин и пароль для доступа</p>
        <div class="error" id="error">Неверный логин или пароль</div>
        <form method="POST" action="/login" id="loginForm">
            <input type="text" name="username" placeholder="Логин" required autofocus>
            <input type="password" name="password" placeholder="Пароль" required>
            <button type="submit">Войти →</button>
        </form>
    </div>
    <script>
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('error')) {
            document.getElementById('error').style.display = 'block';
        }
    </script>
</body>
</html>
    `);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = getUsers();

    if (users[username] && bcrypt.compareSync(password, users[username].password)) {
        req.session.authenticated = true;
        req.session.username = username;
        res.redirect('/');
    } else {
        res.redirect('/login?error=1');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ============================================
// API: СМЕНА ПАРОЛЯ
// ============================================
app.post('/api/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const users = getUsers();
    const username = req.session.username;

    if (!bcrypt.compareSync(currentPassword, users[username].password)) {
        return res.json({ success: false, error: 'Неверный текущий пароль' });
    }

    users[username].password = bcrypt.hashSync(newPassword, 10);
    saveUsers(users);
    res.json({ success: true });
});

// ============================================
// API: СИСТЕМНАЯ ИНФОРМАЦИЯ
// ============================================
app.get('/api/system', requireAuth, (req, res) => {
    const uptime = os.uptime();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    exec('ps aux 2>/dev/null | wc -l || echo 0', (err, stdout) => {
        exec('df -h $HOME 2>/dev/null | tail -1', (err2, dfOut) => {
            let diskTotal = '-', diskUsed = '-', diskPercent = '0';
            if (dfOut) {
                const parts = dfOut.trim().split(/\s+/);
                if (parts.length >= 5) {
                    diskTotal = parts[1];
                    diskUsed = parts[2];
                    diskPercent = parts[4].replace('%', '');
                }
            }

            res.json({
                hostname: os.hostname(),
                platform: os.platform(),
                arch: os.arch(),
                uptime: uptime,
                totalMemory: (totalMem / 1024 / 1024).toFixed(0),
                freeMemory: (freeMem / 1024 / 1024).toFixed(0),
                usedMemory: ((totalMem - freeMem) / 1024 / 1024).toFixed(0),
                memoryPercent: (((totalMem - freeMem) / totalMem) * 100).toFixed(1),
                processes: parseInt(stdout.trim()) - 1 || 0,
                cpus: os.cpus().length,
                diskTotal,
                diskUsed,
                diskPercent
            });
        });
    });
});

// ============================================
// API: ФАЙЛЫ
// ============================================
app.get('/api/files', requireAuth, (req, res) => {
    const dir = req.query.path || os.homedir();
    try {
        const items = fs.readdirSync(dir).map(name => {
            try {
                const fullPath = path.join(dir, name);
                const stat = fs.statSync(fullPath);
                return {
                    name,
                    isDirectory: stat.isDirectory(),
                    size: stat.size,
                    modified: stat.mtime,
                    permissions: '0' + (stat.mode & parseInt('777', 8)).toString(8)
                };
            } catch {
                return { name, isDirectory: false, size: 0, modified: null, permissions: '---' };
            }
        });
        res.json({ path: dir, items });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Скачивание файла
app.get('/api/files/download', requireAuth, (req, res) => {
    const filePath = req.query.path;
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Файл не найден' });
    }
    res.download(filePath);
});

// Удаление файла
app.post('/api/files/delete', requireAuth, (req, res) => {
    const { filePath } = req.body;
    try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            fs.rmSync(filePath, { recursive: true });
        } else {
            fs.unlinkSync(filePath);
        }
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Создание папки
app.post('/api/files/mkdir', requireAuth, (req, res) => {
    const { dirPath } = req.body;
    try {
        fs.mkdirSync(dirPath, { recursive: true });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Загрузка файлов
app.post('/api/upload', requireAuth, upload.array('files', 50), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.json({ success: false, error: 'Файлы не получены' });
    }
    const uploaded = req.files.map(f => ({
        name: f.originalname,
        size: f.size,
        path: f.path
    }));
    res.json({ success: true, files: uploaded });
});

// Чтение текстового файла
app.get('/api/files/read', requireAuth, (req, res) => {
    const filePath = req.query.path;
    try {
        const stat = fs.statSync(filePath);
        if (stat.size > 2 * 1024 * 1024) {
            return res.json({ error: 'Файл слишком большой (макс 2MB)' });
        }
        const content = fs.readFileSync(filePath, 'utf8');
        res.json({ success: true, content, size: stat.size });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Сохранение файла
app.post('/api/files/save', requireAuth, (req, res) => {
    const { filePath, content } = req.body;
    try {
        fs.writeFileSync(filePath, content, 'utf8');
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ============================================
// API: ПРОЦЕССЫ
// ============================================
app.get('/api/processes', requireAuth, (req, res) => {
    exec('ps aux 2>/dev/null || ps', (err, stdout) => {
        const lines = stdout.trim().split('\n');
        const processes = lines.slice(1).map(line => {
            const parts = line.trim().split(/\s+/);
            return {
                user: parts[0],
                pid: parts[1],
                cpu: parts[2] || '0',
                mem: parts[3] || '0',
                command: parts.slice(10).join(' ') || parts.slice(4).join(' ')
            };
        }).filter(p => p.pid);
        res.json(processes);
    });
});

// Убить процесс
app.post('/api/processes/kill', requireAuth, (req, res) => {
    const { pid } = req.body;
    exec(`kill ${pid}`, (err) => {
        res.json({ success: !err, error: err ? err.message : null });
    });
});

// ============================================
// API: СЕРВИСЫ (БОТЫ)
// ============================================
const runningProcesses = {};

app.get('/api/services', requireAuth, (req, res) => {
    const services = {};
    for (const [name, info] of Object.entries(runningProcesses)) {
        services[name] = {
            pid: info.pid,
            command: info.command,
            cwd: info.cwd,
            startedAt: info.startedAt,
            logs: info.logs.slice(-50)
        };
    }
    res.json(services);
});

app.post('/api/service/start', requireAuth, (req, res) => {
    const { name, command, cwd } = req.body;

    if (!name || !command) {
        return res.json({ success: false, error: 'Укажите имя и команду' });
    }

    if (runningProcesses[name]) {
        return res.json({ success: false, error: 'Уже запущен' });
    }

    const workDir = cwd || os.homedir();
    const parts = command.split(' ');

    try {
        const proc = spawn(parts[0], parts.slice(1), {
            cwd: workDir,
            env: { ...process.env, HOME: os.homedir() }
        });

        runningProcesses[name] = {
            process: proc,
            pid: proc.pid,
            command,
            cwd: workDir,
            startedAt: new Date().toISOString(),
            logs: []
        };

        proc.stdout.on('data', (data) => {
            const text = data.toString();
            runningProcesses[name]?.logs.push({ type: 'stdout', text, time: new Date().toISOString() });
            if (runningProcesses[name]?.logs.length > 200) {
                runningProcesses[name].logs = runningProcesses[name].logs.slice(-100);
            }
            io.emit('service-log', { service: name, type: 'stdout', data: text });
        });

        proc.stderr.on('data', (data) => {
            const text = data.toString();
            runningProcesses[name]?.logs.push({ type: 'stderr', text, time: new Date().toISOString() });
            io.emit('service-log', { service: name, type: 'stderr', data: text });
        });

        proc.on('exit', (code) => {
            io.emit('service-stopped', { name, code });
            delete runningProcesses[name];
        });

        proc.on('error', (err) => {
            io.emit('service-log', { service: name, type: 'stderr', data: 'Error: ' + err.message });
            delete runningProcesses[name];
        });

        res.json({ success: true, pid: proc.pid });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/service/stop', requireAuth, (req, res) => {
    const { name } = req.body;
    if (runningProcesses[name]) {
        try {
            runningProcesses[name].process.kill('SIGTERM');
            setTimeout(() => {
                if (runningProcesses[name]) {
                    runningProcesses[name].process.kill('SIGKILL');
                    delete runningProcesses[name];
                }
            }, 3000);
        } catch (e) {}
        delete runningProcesses[name];
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Не найден' });
    }
});

app.post('/api/service/restart', requireAuth, (req, res) => {
    const { name } = req.body;
    if (runningProcesses[name]) {
        const { command, cwd } = runningProcesses[name];
        try { runningProcesses[name].process.kill(); } catch (e) {}
        delete runningProcesses[name];

        setTimeout(() => {
            const parts = command.split(' ');
            const proc = spawn(parts[0], parts.slice(1), { cwd });
            runningProcesses[name] = {
                process: proc, pid: proc.pid, command, cwd,
                startedAt: new Date().toISOString(), logs: []
            };
            proc.stdout.on('data', (data) => {
                runningProcesses[name]?.logs.push({ type: 'stdout', text: data.toString() });
                io.emit('service-log', { service: name, type: 'stdout', data: data.toString() });
            });
            proc.stderr.on('data', (data) => {
                runningProcesses[name]?.logs.push({ type: 'stderr', text: data.toString() });
                io.emit('service-log', { service: name, type: 'stderr', data: data.toString() });
            });
            proc.on('exit', () => { delete runningProcesses[name]; });
            res.json({ success: true, pid: proc.pid });
        }, 1000);
    } else {
        res.json({ success: false, error: 'Не найден' });
    }
});

// ============================================
// API: ВЫПОЛНЕНИЕ КОМАНД
// ============================================
app.post('/api/run', requireAuth, (req, res) => {
    const { command, cwd } = req.body;
    exec(command, {
        timeout: 30000,
        cwd: cwd || os.homedir(),
        env: { ...process.env, HOME: os.homedir() }
    }, (err, stdout, stderr) => {
        res.json({
            success: !err,
            stdout: stdout || '',
            stderr: stderr || '',
            error: err ? err.message : null
        });
    });
});

// ============================================
// WEBSOCKET
// ============================================
io.on('connection', (socket) => {
    console.log('Клиент подключён');

    socket.on('terminal-input', (data) => {
        exec(data.command, {
            timeout: 30000,
            cwd: data.cwd || os.homedir(),
            env: { ...process.env, HOME: os.homedir() }
        }, (err, stdout, stderr) => {
            socket.emit('terminal-output', {
                stdout: stdout || '',
                stderr: stderr || err?.message || ''
            });
        });
    });

    socket.on('disconnect', () => {
        console.log('Клиент отключён');
    });
});

// ============================================
// ГЛАВНАЯ СТРАНИЦА (ПОСЛЕ АВТОРИЗАЦИИ)
// ============================================
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Статика
app.use(express.static('public'));

// ============================================
// ЗАПУСК
// ============================================
server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('🚀 ================================');
    console.log(`🚀  Сервер запущен на порту ${PORT}`);
    console.log('🚀 ================================');
    console.log('');

    // Показываем IP-адреса
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`📡 Открой: http://${net.address}:${PORT}`);
            }
        }
    }
    console.log(`📡 Локально: http://localhost:${PORT}`);
    console.log('');
    console.log('👤 Логин: admin');
    console.log('🔑 Пароль: admin123');
    console.log('');
});
