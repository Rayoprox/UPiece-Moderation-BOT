const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const { join } = require('path');
const db = require('./utils/db');

const app = express();
const SCOPES = ['identify', 'guilds'];

// Auth Strategy
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new Strategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: SCOPES
}, (_, __, profile, done) => process.nextTick(() => done(null, profile))));

// Middleware & Config
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(express.static(join(__dirname, 'public')));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } 
}));
app.use(passport.initialize());
app.use(passport.session());

// Guards
const auth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/discord');

// Auth Routes
app.get('/auth/discord', passport.authenticate('discord', { scope: SCOPES }));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => req.logout(() => res.redirect('/')));

// --- Dashboard Routes ---

app.get('/', auth, async (req, res) => {
    try {
        const { botClient } = req.app.locals;
        
        // 1. Obtener conteo de Modlogs
        const modlogs = await db.query('SELECT COUNT(*) as count FROM modlogs');
        
        // 2. Obtener Tickets Activos (Lógica corregida)
        let activeTickets = 0;
        try {
            // CAMBIO AQUÍ: Usamos SELECT * para evitar errores de nombre de columna
            const { rows } = await db.query("SELECT * FROM tickets WHERE status = 'OPEN'");
            
            if (rows.length && botClient) {
                activeTickets = rows.filter(t => {
                    // Buscamos el ID en las propiedades más probables
                    const cId = t.channel_id || t.channelid || t.id;
                    return cId && botClient.channels.cache.has(cId);
                }).length;
            }
        } catch (err) { 
            // Si la tabla tickets no existe, simplemente mostramos 0 sin crashear
            console.warn("[Dashboard] Error leyendo tickets (¿Existe la tabla?):", err.message); 
        }

        res.render('dashboard', {
            bot: botClient?.user,
            user: req.user,
            totalModlogs: modlogs.rows[0].count,
            activeTickets
        });
    } catch (e) {
        console.error(e);
        res.status(500).send('Server Error');
    }
});

app.get('/guilds', auth, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT guildid, prefix FROM guild_settings');
        res.render('guilds', { 
            bot: req.app.locals.botClient?.user, 
            user: req.user, 
            guilds: rows 
        });
    } catch (e) {
        console.error(e);
        res.status(500).send('Error loading guilds');
    }
});

app.get('/modlogs', auth, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const { rows } = await db.query('SELECT * FROM modlogs ORDER BY timestamp DESC LIMIT $1', [limit]);
        res.render('modlogs', { 
            bot: req.app.locals.botClient?.user, 
            user: req.user, 
            modlogs: rows 
        });
    } catch (e) {
        console.error(e);
        res.status(500).send('Error loading modlogs');
    }
});

module.exports = app;