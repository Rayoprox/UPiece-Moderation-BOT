/**
 * ANTINUKE IMPROVEMENTS - EJEMPLOS DE CÓDIGO PARA IMPLEMENTAR
 * 
 * Este archivo contiene ejemplos de mejoras para el sistema antinuke
 * que pueden integrarse en utils/antiNuke.js
 */

// ═════════════════════════════════════════════════════════════════════
// MEJORA #3: COOLDOWN PROGRESIVO
// ═════════════════════════════════════════════════════════════════════

const userNukeHistory = new Map(); // userId -> { count, timings: [], lastAction }

async function calculateDynamicCooldown(executorId) {
    const history = userNukeHistory.get(executorId);
    if (!history) return 5 * 60 * 1000; // 5 minutos (primera vez)

    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);

    // Limpiar eventos de hace más de 24h
    history.timings = history.timings.filter(t => t > oneDayAgo);

    const timingsInDay = history.timings.length;

    if (timingsInDay === 1) return 15 * 60 * 1000;   // 15 min, segunda vez
    if (timingsInDay === 2) return 30 * 60 * 1000;   // 30 min, tercera vez
    if (timingsInDay >= 3) return 60 * 60 * 1000;    // 1 hora, cuarta+ vez

    return 5 * 60 * 1000;
}

async function recordNukeAttempt(executorId) {
    let history = userNukeHistory.get(executorId);
    
    if (!history) {
        history = { timings: [], lastAction: null };
    }

    history.timings.push(Date.now());
    history.lastAction = Date.now();
    userNukeHistory.set(executorId, history);

    return history.timings.length;
}

// En triggerProtection, reemplazar:
// setTimeout(() => triggeredUsers.delete(triggerKey), 5 * 60 * 1000);
// Por:
// const cooldown = await calculateDynamicCooldown(executorId);
// const attemptCount = await recordNukeAttempt(executorId);
// 
// if (attemptCount >= 3) {
//     // Ban permanente si múltiples intentos
//     await guild.members.ban(user.id, {
//         deleteMessageSeconds: 604800,
//         reason: `Anti-Nuke: Repeated nuke attempts (${attemptCount}x in 24h) - PERMANENT BAN`
//     }).catch(e => console.error("Ban failed:", e.message));
// }
//
// setTimeout(() => triggeredUsers.delete(triggerKey), cooldown);


// ═════════════════════════════════════════════════════════════════════
// MEJORA #4: MÚLTIPLES BACKUPS CON VALIDACIÓN
// ═════════════════════════════════════════════════════════════════════

async function createBackupVersioned(guild) {
    if (!guild) return false;
    if (backingUpGuilds.has(guild.id)) {
        console.log(`[BACKUP] Backup already in progress for ${guild.name}.`);
        return 'IN_PROGRESS';
    }
    backingUpGuilds.add(guild.id);

    try {
        const channels = guild.channels.cache.map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            parentId: c.parentId,
            parentName: c.parent ? c.parent.name : null,
            position: c.position,
            permissionOverwrites: c.permissionOverwrites ? c.permissionOverwrites.cache.map(p => {
                let roleName = null;
                if (p.type === OverwriteType.Role) {
                    const role = guild.roles.cache.get(p.id);
                    if (role) roleName = role.name;
                }
                return { 
                    id: p.id, 
                    type: p.type, 
                    allow: p.allow.bitfield.toString(), 
                    deny: p.deny.bitfield.toString(), 
                    roleName: roleName 
                };
            }) : []
        }));

        const roles = guild.roles.cache
            .filter(r => r.name !== '@everyone' && !r.managed)
            .map(r => ({
                id: r.id, 
                name: r.name, 
                color: r.color, 
                hoist: r.hoist, 
                permissions: r.permissions.bitfield.toString(), 
                position: r.position
            }));

        const backupData = { 
            channels, 
            roles, 
            timestamp: Date.now(),
            guildName: guild.name,
            channelCount: channels.length,
            roleCount: roles.length
        };

        // Validar antes de guardar
        await validateBackup(backupData);

        // Obtener backups anteriores
        const result = await db.query(
            `SELECT backup_history FROM guild_backups WHERE guildid = $1`,
            [guild.id]
        );

        let backupHistory = [];
        if (result.rows.length > 0 && result.rows[0].backup_history) {
            backupHistory = JSON.parse(result.rows[0].backup_history);
        }

        // Agregar nuevo backup al inicio
        backupHistory.unshift(backupData);

        // Mantener solo últimos 3 backups
        backupHistory = backupHistory.slice(0, 3);

        // Guardar en DB
        await db.query(
            `INSERT INTO guild_backups (guildid, data, last_backup, backup_history) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (guildid) DO UPDATE SET 
             data = $2, 
             last_backup = $3,
             backup_history = $4`,
            [guild.id, backupData, Date.now(), JSON.stringify(backupHistory)]
        );

        console.log(`[BACKUP] ${guild.name}: Created v${backupHistory.length} (${channels.length} channels, ${roles.length} roles)`);
        return 'SUCCESS';
    } catch (e) {
        console.error(`[BACKUP ERROR] Guild ${guild.id}:`, e);
        return 'ERROR';
    } finally {
        backingUpGuilds.delete(guild.id);
    }
}

async function validateBackup(backupData) {
    if (!backupData.channels || !Array.isArray(backupData.channels)) {
        throw new Error('Invalid backup: channels is not an array');
    }
    
    if (!backupData.roles || !Array.isArray(backupData.roles)) {
        throw new Error('Invalid backup: roles is not an array');
    }

    if (backupData.channels.length === 0 && backupData.roles.length === 0) {
        throw new Error('Invalid backup: both channels and roles are empty (guild might be corrupted)');
    }

    if (!backupData.timestamp || typeof backupData.timestamp !== 'number') {
        throw new Error('Invalid backup: missing or invalid timestamp');
    }

    // Verificar que haya al menos 1 canal de texto/voz
    const hasValidChannels = backupData.channels.some(c => [0, 2, 4, 5, 13].includes(c.type));
    if (backupData.channels.length > 0 && !hasValidChannels) {
        throw new Error('Invalid backup: no valid channel types found');
    }

    return true;
}

async function restoreGuildSafe(guild) {
    if (restoringGuilds.has(guild.id)) return 'IN_PROGRESS';
    restoringGuilds.add(guild.id);

    try {
        const result = await db.query(
            `SELECT backup_history FROM guild_backups WHERE guildid = $1`,
            [guild.id]
        );

        if (result.rows.length === 0) {
            return 'NO_DATA';
        }

        let backupHistory = [];
        if (result.rows[0].backup_history) {
            backupHistory = JSON.parse(result.rows[0].backup_history);
        }

        if (backupHistory.length === 0) {
            return 'NO_DATA';
        }

        console.log(`[RESTORE] Starting safe restoration for ${guild.name} with ${backupHistory.length} available backups...`);

        // Intentar con cada backup, comenzando por el más reciente
        for (let i = 0; i < backupHistory.length; i++) {
            const backup = backupHistory[i];
            const age = Math.floor((Date.now() - backup.timestamp) / 1000);

            try {
                console.log(`[RESTORE] Attempting backup ${i + 1}/${backupHistory.length} (${age}s old)...`);
                
                // Validar antes de restaurar
                await validateBackup(backup);

                // Ejecutar restauración
                await performDetailedRestore(guild, backup);

                console.log(`[RESTORE] ✅ Restoration successful using backup ${i + 1}`);
                return 'SUCCESS';
            } catch (e) {
                console.error(`[RESTORE] ❌ Backup ${i + 1} failed: ${e.message}`);
                if (i === backupHistory.length - 1) {
                    // Última opción fallida
                    throw new Error(`All ${backupHistory.length} backups failed to restore`);
                }
                // Intentar con el siguiente backup
                continue;
            }
        }

        return 'FAILED_ALL_BACKUPS';
    } catch (e) {
        console.error('[RESTORE ERROR]', e);
        return 'ERROR';
    } finally {
        restoringGuilds.delete(guild.id);
    }
}

async function performDetailedRestore(guild, backup) {
    const { roles: backupRoles, channels: backupChannels } = backup;

    // Paso 1: Limpiar roles que no estaban en el backup
    const currentRoles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed && r.editable);
    for (const role of currentRoles.values()) {
        const isInBackup = backupRoles.some(br => br.name === role.name);
        if (!isInBackup) {
            await role.delete('Anti-Nuke Cleanup').catch(() => {});
        }
    }

    // Paso 2: Limpiar canales que no estaban en el backup
    const currentChannels = guild.channels.cache.filter(c => c.deletable);
    for (const channel of currentChannels.values()) {
        const isInBackup = backupChannels.some(bc => bc.name === channel.name && bc.type === channel.type);
        if (!isInBackup) {
            await channel.delete('Anti-Nuke Cleanup').catch(() => {});
        }
    }

    // Paso 3: Restaurar roles
    backupRoles.sort((a, b) => b.position - a.position);
    for (const r of backupRoles) {
        const exists = guild.roles.cache.find(role => role.name === r.name);
        if (!exists) {
            await guild.roles.create({
                name: r.name,
                color: r.color,
                hoist: r.hoist,
                permissions: BigInt(r.permissions),
                position: r.position,
                reason: 'Anti-Nuke Restore'
            }).catch(() => {});
        }
    }

    // Paso 4: Restaurar canales
    const resolveOverwrites = (savedOverwrites) => {
        if (!savedOverwrites) return [];
        return savedOverwrites.map(o => {
            let targetId = o.id;
            if (o.type === OverwriteType.Role) {
                if (o.roleName === '@everyone') {
                    targetId = guild.roles.everyone.id;
                } else if (o.roleName) {
                    const newRole = guild.roles.cache.find(r => r.name === o.roleName);
                    if (newRole) targetId = newRole.id;
                    else return null;
                }
            }
            return { id: targetId, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) };
        }).filter(o => o !== null);
    };

    const categories = backupChannels.filter(c => c.type === 4); // ChannelType.GuildCategory
    for (const c of categories) {
        if (!guild.channels.cache.find(ch => ch.name === c.name && ch.type === c.type)) {
            await guild.channels.create({
                name: c.name,
                type: c.type,
                position: c.position,
                permissionOverwrites: resolveOverwrites(c.permissionOverwrites),
                reason: 'Anti-Nuke Restore'
            }).catch(() => {});
        }
    }

    const channels = backupChannels.filter(c => c.type !== 4);
    for (const c of channels) {
        if (!guild.channels.cache.find(ch => ch.name === c.name && ch.type === c.type)) {
            const parent = c.parentName
                ? guild.channels.cache.find(cat => cat.name === c.parentName && cat.type === 4)
                : null;

            await guild.channels.create({
                name: c.name,
                type: c.type,
                parent: parent ? parent.id : null,
                position: c.position,
                permissionOverwrites: resolveOverwrites(c.permissionOverwrites),
                reason: 'Anti-Nuke Restore'
            }).catch(() => {});

            await new Promise(r => setTimeout(r, 200));
        }
    }

    console.log(`[RESTORE] Restoration complete for ${guild.name}`);
}


// ═════════════════════════════════════════════════════════════════════
// MEJORA #6: LOGGING DETALLADO DE INTENTOS
// ═════════════════════════════════════════════════════════════════════

async function logNukeAttempt(guildId, executorId, actionType, threshold, count, triggered = false) {
    try {
        await db.query(
            `INSERT INTO nuke_attempts 
             (guildid, executorid, action_type, threshold, count, triggered, attempted_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [guildId, executorId, actionType, threshold, count, triggered, Date.now()]
        );
    } catch (e) {
        console.error('[LOG ERROR]', e);
    }
}

async function getNukeAttemptsInLastHour(guildId) {
    try {
        const result = await db.query(
            `SELECT * FROM nuke_attempts 
             WHERE guildid = $1 AND attempted_at > (NOW() - INTERVAL '1 hour')
             ORDER BY attempted_at DESC
             LIMIT 50`,
            [guildId]
        );
        return result.rows;
    } catch (e) {
        console.error('[LOG ERROR]', e);
        return [];
    }
}

async function getNukeAttemptsStats(guildId) {
    try {
        const result = await db.query(
            `SELECT 
                COUNT(*) as total_attempts,
                SUM(CASE WHEN triggered THEN 1 ELSE 0 END) as successful_nukes,
                COUNT(DISTINCT executorid) as unique_attackers,
                action_type,
                MAX(attempted_at) as last_attempt
             FROM nuke_attempts 
             WHERE guildid = $1 AND attempted_at > (NOW() - INTERVAL '24 hours')
             GROUP BY action_type`,
            [guildId]
        );
        return result.rows;
    } catch (e) {
        console.error('[LOG ERROR]', e);
        return [];
    }
}


// ═════════════════════════════════════════════════════════════════════
// MEJORA #7: CLEANUP AUTOMÁTICO DE CACHÉ
// ═════════════════════════════════════════════════════════════════════

const CACHE_MAX_TTL = 60 * 1000;        // 60 segundos
const CLEANUP_INTERVAL = 30 * 1000;     // Limpiar cada 30 segundos

function startCacheCleanup() {
    setInterval(() => {
        const now = Date.now();
        let cleaned = 0;
        let totalSize = limitCache.size;

        for (const [key, data] of limitCache.entries()) {
            const age = now - (data.createdAt || now - CACHE_MAX_TTL + 1000);

            if (age > CACHE_MAX_TTL) {
                if (data.timer) clearTimeout(data.timer);
                limitCache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`[CACHE CLEANUP] Removed ${cleaned}/${totalSize} stale entries`);
        }
    }, CLEANUP_INTERVAL);
}

// Llamar al inicializar el módulo:
// startCacheCleanup();


// ═════════════════════════════════════════════════════════════════════
// MEJORA BONUS: SNAPSHOT DE ESTADO (Prevenir race conditions)
// ═════════════════════════════════════════════════════════════════════

const guildStateSnapshots = new Map(); // guildId -> { channels, roles, timestamp }
const SNAPSHOT_INTERVAL = 3000; // Snapshots cada 3 segundos

async function snapshotGuildState(guild) {
    const snapshot = {
        channels: guild.channels.cache.map(c => ({ id: c.id, name: c.name, type: c.type })),
        roles: guild.roles.cache.map(r => ({ id: r.id, name: r.name })),
        timestamp: Date.now()
    };
    return snapshot;
}

async function detectMassChanges(guild, executorId) {
    const current = await snapshotGuildState(guild);
    const previous = guildStateSnapshots.get(guild.id);

    if (!previous) {
        guildStateSnapshots.set(guild.id, current);
        return null;
    }

    const deletedChannels = previous.channels.filter(
        pc => !current.channels.find(cc => cc.id === pc.id)
    );

    const createdRoles = current.roles.filter(
        cr => !previous.roles.find(pr => pr.id === cr.id)
    );

    guildStateSnapshots.set(guild.id, current);

    const timeDiff = (current.timestamp - previous.timestamp) / 1000; // segundos

    if (timeDiff > 0) {
        const deleteRate = deletedChannels.length / timeDiff;
        const createRate = createdRoles.length / timeDiff;

        console.log(`[SNAPSHOT] Guild: ${guild.name} | Deleted: ${deletedChannels.length}/${deleteRate.toFixed(2)}/s | Created: ${createdRoles.length}/${createRate.toFixed(2)}/s`);

        // Si hay más de 2 cambios por segundo, es muy sospechoso
        if (deleteRate > 2 || createRate > 2) {
            return {
                deletedChannels,
                createdRoles,
                rate: Math.max(deleteRate, createRate),
                timeDiff,
                suspicious: true
            };
        }
    }

    return null;
}

function startSnapshotting(guild) {
    setInterval(async () => {
        try {
            const suspicious = await detectMassChanges(guild);
            if (suspicious) {
                console.log('[SNAPSHOT] Suspicious activity detected!', suspicious);
                // Ejecutar acciones de protección si es necesario
            }
        } catch (e) {
            console.error('[SNAPSHOT ERROR]', e);
        }
    }, SNAPSHOT_INTERVAL);
}

module.exports = {
    calculateDynamicCooldown,
    recordNukeAttempt,
    createBackupVersioned,
    validateBackup,
    restoreGuildSafe,
    performDetailedRestore,
    logNukeAttempt,
    getNukeAttemptsInLastHour,
    getNukeAttemptsStats,
    startCacheCleanup,
    snapshotGuildState,
    detectMassChanges,
    startSnapshotting
};
