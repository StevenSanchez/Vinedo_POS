/**
 * ============================================================================
 * ARCHIVO: api/server.js
 * PROPÓSITO: arrancar el API HTTP (Express) y configurar la conexión a MySQL.
 * ============================================================================
 */
const express = require('express')
const app = express()
const mysql = require('mysql2')
const routes = require('./routes')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

app.set('port', parseInt(process.env.VINEDOPOS_API_PORT || '9000', 10))

const configPath = path.join(__dirname, 'config.json')
let db = {
    host: process.env.VINEDOPOS_DB_HOST || '127.0.0.1',
    port: process.env.VINEDOPOS_DB_PORT || '3306',
    user: process.env.VINEDOPOS_DB_USER || 'root',
    password: process.env.VINEDOPOS_DB_PASSWORD || '',
    database: process.env.VINEDOPOS_DB_NAME || 'vinedopos',
    charset: 'utf8mb4'
}
if (fs.existsSync(configPath)) {
    try {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        if (cfg.db) {
            db = Object.assign({}, db, cfg.db)
        }
        console.log('Usando config.json para conexión MySQL:', db.host + ':' + db.port)
    } catch (e) {
        console.log('No se pudo leer config.json', e.message)
    }
}

let conexion = null

function crearConexion() {
    const conn = mysql.createConnection(db)
    conn.on('error', (err) => {
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET' || err.fatal || err.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
            if (conexion === conn) conexion = null
            try { conn.destroy() } catch (e) {}
        }
    })
    return conn
}

function obtenerConexion() {
    if (conexion) {
        if (conexion.state === 'disconnected' || conexion.state === 'closed' || conexion.state === 'protocol_error') {
            try { conexion.destroy() } catch (e) {}
            conexion = null
        }
    }
    if (!conexion) {
        conexion = crearConexion()
    }
    return conexion
}

//middlewares------------------------
app.use((req, res, next) => {
    req.getConnection = (callback) => {
        try {
            const conn = obtenerConexion()
            callback(null, conn)
        } catch (e) {
            callback(e)
        }
    }
    next()
})
app.use(express.json())
app.use(cors())

// Servir build del frontend si existe (para instalador todo-en-uno)
const buildPath = path.join(__dirname, '..', 'vinedopos', 'build')
const indexHtml = path.join(buildPath, 'index.html')
if (fs.existsSync(buildPath)) {
    app.use(express.static(buildPath))
    app.get('*', (req, res, next) => {
        const accept = req.headers.accept || ''
        if (accept.indexOf('text/html') === -1) return next()
        if (!fs.existsSync(indexHtml)) return next()
        res.sendFile(indexHtml)
    })
}

//Rutas --------------------------------------
app.use('/', routes)

//Server running -----------------------------
app.listen(app.get('port'), '0.0.0.0', () => {
    console.log('Server running on port', app.get('port'))
    console.log('Accesible desde red local')
})
