const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../utils/db.js');
const vpnDetector = require('../../utils/vpnDetector.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('checkalts')
        .setDescription('Developer: Full alt-account diagnostic across all verified users.')
        .addStringOption(opt =>
            opt.setName('guild')
                .setDescription('Guild ID to scan (defaults to current guild)')
                .setRequired(false))
        .addStringOption(opt =>
            opt.setName('user')
                .setDescription('Focus on a specific user ID')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        const targetGuild = interaction.options.getString('guild') || interaction.guildId;
        const focusUser = interaction.options.getString('user');

        await interaction.editReply({ content: '🔍 **Running full alt-account diagnostic…** This may take a moment.' });

        try {
            // ── 1. Gather all verified user IPs for this guild ──
            const ipRows = (await db.query(
                `SELECT userid, ip_address, fingerprint, user_agent, timestamp, risk_score
                 FROM user_ips
                 WHERE guildid = $1
                 ORDER BY timestamp DESC`,
                [targetGuild]
            )).rows;

            if (ipRows.length === 0) {
                return interaction.editReply({ content: '📭 No verification IP records found for this guild.' });
            }

            // ── 2. Gather all bans (active) ──
            const banRows = (await db.query(
                `SELECT userid, usertag, reason, timestamp
                 FROM modlogs
                 WHERE guildid = $1 AND action = 'BAN' AND status = 'ACTIVE'`,
                [targetGuild]
            )).rows;

            const bannedUserIds = new Set(banRows.map(r => r.userid));
            const bannedByTag = {};
            banRows.forEach(r => { bannedByTag[r.userid] = r; });

            // ── 3. Gather verification status ──
            const verifiedRows = (await db.query(
                `SELECT userid, verified, verified_at
                 FROM verification_status
                 WHERE guildid = $1`,
                [targetGuild]
            )).rows;

            const verifiedSet = new Set(verifiedRows.filter(r => r.verified).map(r => r.userid));
            const verifiedAtMap = {};
            verifiedRows.forEach(r => { if (r.verified_at) verifiedAtMap[r.userid] = r.verified_at; });

            // ── 4. Build IP → users map and user → IPs map ──
            const ipToUsers = {};   // ip → Set<userid>
            const userToIPs = {};   // userid → Set<ip>
            const fpToUsers = {};   // fingerprint → Set<userid>
            const userToFPs = {};   // userid → Set<fingerprint>
            const userLatestUA = {}; // userid → latest user_agent
            const userLatestTime = {}; // userid → latest timestamp
            const userRiskScores = {}; // userid → latest risk_score

            for (const row of ipRows) {
                if (row.ip_address) {
                    if (!ipToUsers[row.ip_address]) ipToUsers[row.ip_address] = new Set();
                    ipToUsers[row.ip_address].add(row.userid);

                    if (!userToIPs[row.userid]) userToIPs[row.userid] = new Set();
                    userToIPs[row.userid].add(row.ip_address);
                }

                if (row.fingerprint) {
                    if (!fpToUsers[row.fingerprint]) fpToUsers[row.fingerprint] = new Set();
                    fpToUsers[row.fingerprint].add(row.userid);

                    if (!userToFPs[row.userid]) userToFPs[row.userid] = new Set();
                    userToFPs[row.userid].add(row.fingerprint);
                }

                if (!userLatestTime[row.userid] || row.timestamp > userLatestTime[row.userid]) {
                    userLatestTime[row.userid] = row.timestamp;
                    userLatestUA[row.userid] = row.user_agent;
                    userRiskScores[row.userid] = row.risk_score || 0;
                }
            }

            // ── 5. VPN scan on all unique IPs ──
            const allIPs = Object.keys(ipToUsers);
            const vpnIPs = new Set();
            const datacenterIPs = new Set();
            if (vpnDetector.ready) {
                for (const ip of allIPs) {
                    const result = vpnDetector.check(ip);
                    if (result.isVPN) vpnIPs.add(ip);
                    else if (result.isDatacenter) datacenterIPs.add(ip);
                }
            }

            // Track which users used VPN
            const usersWithVPN = new Set();
            for (const ip of vpnIPs) {
                for (const uid of (ipToUsers[ip] || [])) usersWithVPN.add(uid);
            }
            for (const ip of datacenterIPs) {
                for (const uid of (ipToUsers[ip] || [])) usersWithVPN.add(uid);
            }

            // ── 6. Detect alt clusters (Union-Find) ──
            const parent = {};
            function find(x) {
                if (!parent[x]) parent[x] = x;
                while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
                return x;
            }
            function union(a, b) { parent[find(a)] = find(b); }

            for (const [, users] of Object.entries(ipToUsers)) {
                const arr = [...users];
                for (let i = 1; i < arr.length; i++) union(arr[0], arr[i]);
            }
            for (const [, users] of Object.entries(fpToUsers)) {
                const arr = [...users];
                for (let i = 1; i < arr.length; i++) union(arr[0], arr[i]);
            }

            const clusters = {};
            const allUsers = new Set([...Object.keys(userToIPs), ...Object.keys(userToFPs)]);
            for (const uid of allUsers) {
                const root = find(uid);
                if (!clusters[root]) clusters[root] = new Set();
                clusters[root].add(uid);
            }

            const altGroups = Object.values(clusters)
                .filter(s => s.size >= 2)
                .map(s => [...s])
                .sort((a, b) => b.length - a.length);

            // ── 7. Fetch Discord user info ──
            const relevantUsers = new Set();
            for (const group of altGroups) group.forEach(u => relevantUsers.add(u));
            if (focusUser) relevantUsers.add(focusUser);

            const userInfo = {};
            for (const uid of relevantUsers) {
                try {
                    const u = await interaction.client.users.fetch(uid);
                    userInfo[uid] = {
                        tag: u.tag || u.username,
                        createdAt: u.createdTimestamp,
                        avatar: u.avatar !== null,
                        daysOld: Math.floor((Date.now() - u.createdTimestamp) / 86400000)
                    };
                } catch {
                    userInfo[uid] = { tag: uid, createdAt: null, avatar: false, daysOld: null };
                }
            }

            // ── 8. If focusing on a specific user ──
            if (focusUser) {
                return sendUserFocusReport(interaction, focusUser, {
                    userToIPs, ipToUsers, fpToUsers, userToFPs, userInfo, bannedUserIds, bannedByTag,
                    verifiedSet, verifiedAtMap, userLatestUA, userLatestTime, userRiskScores,
                    ipRows, targetGuild, vpnIPs, datacenterIPs, usersWithVPN
                });
            }

            // ── 9. Build diagnostic embeds per alt cluster ──
            const embeds = [];
            let detectedEvaders = 0;
            let totalAltAccounts = 0;
            const threatBreakdown = { critical: 0, high: 0, medium: 0, low: 0 };

            for (const group of altGroups) {
                totalAltAccounts += group.length;

                const hasBanned = group.some(u => bannedUserIds.has(u));
                const hasVerified = group.some(u => verifiedSet.has(u));
                const bannedInGroup = group.filter(u => bannedUserIds.has(u));
                const verifiedInGroup = group.filter(u => verifiedSet.has(u));
                const isEvasion = hasBanned && hasVerified;
                const hasVPN = group.some(u => usersWithVPN.has(u));

                if (isEvasion) detectedEvaders++;

                // Shared IPs
                const sharedIPs = new Set();
                for (const uid of group) {
                    if (userToIPs[uid]) {
                        for (const ip of userToIPs[uid]) {
                            if (ipToUsers[ip] && ipToUsers[ip].size >= 2) sharedIPs.add(ip);
                        }
                    }
                }

                // Shared fingerprints
                const sharedFPs = new Set();
                for (const uid of group) {
                    if (userToFPs[uid]) {
                        for (const fp of userToFPs[uid]) {
                            if (fpToUsers[fp] && fpToUsers[fp].size >= 2) sharedFPs.add(fp);
                        }
                    }
                }
                const hasFPMatch = sharedFPs.size > 0;

                // User-Agent comparison
                const agents = {};
                for (const uid of group) {
                    if (userLatestUA[uid]) {
                        const short = simplifyUA(userLatestUA[uid]);
                        if (!agents[short]) agents[short] = [];
                        agents[short].push(uid);
                    }
                }
                const sameUA = Object.values(agents).some(a => a.length >= 2);

                // Account ages
                const ages = group.map(u => userInfo[u]?.daysOld).filter(d => d !== null);
                const hasNewAccount = ages.some(a => a < 30);

                // ── Confidence score for this cluster ──
                let confidence = 0;
                const evidence = [];

                if (sharedIPs.size > 0) { confidence += 20; evidence.push(`${sharedIPs.size} shared IP(s)`); }
                if (hasFPMatch) { confidence += 35; evidence.push(`${sharedFPs.size} shared fingerprint(s)`); }
                if (sameUA) { confidence += 15; evidence.push('Same browser/device'); }
                if (hasNewAccount) { confidence += 10; evidence.push('New account(s)'); }
                if (hasBanned) { confidence += 15; evidence.push('Linked to banned user'); }
                if (hasVPN) { confidence += 10; evidence.push('VPN/Proxy used'); }
                if (group.some(u => !userInfo[u]?.avatar)) { confidence += 5; evidence.push('Default avatar'); }
                confidence = Math.min(confidence, 100);

                // ── Threat level ──
                let threatLevel, title, color;
                if (isEvasion && (hasFPMatch || hasVPN)) {
                    threatLevel = 'CRITICAL';
                    title = '🚨 BAN EVASION — Confirmed Alt';
                    color = 0xe74c3c;
                    threatBreakdown.critical++;
                } else if (isEvasion) {
                    threatLevel = 'HIGH';
                    title = '⚠️ BAN EVASION — Probable Alt';
                    color = 0xe67e22;
                    threatBreakdown.high++;
                } else if (hasBanned && hasVPN) {
                    threatLevel = 'HIGH';
                    title = '⚠️ Banned User Cluster + VPN';
                    color = 0xe67e22;
                    threatBreakdown.high++;
                } else if (hasFPMatch && hasVPN) {
                    threatLevel = 'MEDIUM';
                    title = '🔒 Same Device + VPN Cluster';
                    color = 0xf39c12;
                    threatBreakdown.medium++;
                } else if (hasFPMatch) {
                    threatLevel = 'MEDIUM';
                    title = '🖥️ Same Device Cluster';
                    color = 0xf39c12;
                    threatBreakdown.medium++;
                } else if (hasVPN) {
                    threatLevel = 'LOW';
                    title = '🔒 Shared IP Cluster (VPN detected)';
                    color = 0x3498db;
                    threatBreakdown.low++;
                } else {
                    threatLevel = 'LOW';
                    title = '👥 Shared IP Cluster';
                    color = 0x3498db;
                    threatBreakdown.low++;
                }

                // ── Member listing ──
                const memberLines = group.map(uid => {
                    const info = userInfo[uid] || {};
                    const tags = [];
                    if (bannedUserIds.has(uid)) tags.push('🔨 BAN');
                    if (verifiedSet.has(uid)) tags.push('✅ OK');
                    if (usersWithVPN.has(uid)) tags.push('🔒 VPN');
                    if (info.daysOld !== null && info.daysOld < 7) tags.push(`🆕 ${info.daysOld}d`);
                    else if (info.daysOld !== null && info.daysOld < 30) tags.push(`📅 ${info.daysOld}d`);
                    if (!info.avatar) tags.push('🖼️');
                    const riskBadge = userRiskScores[uid] >= 50 ? ' 🔴' : userRiskScores[uid] >= 25 ? ' 🟡' : '';
                    return `> **${info.tag || uid}**${riskBadge}\n> \`${uid}\` ${tags.join(' ')}`;
                }).join('\n');

                // ── IP analysis ──
                const ipAnalysis = [...sharedIPs].slice(0, 8).map(ip => {
                    const usersOnIp = [...(ipToUsers[ip] || [])].filter(u => group.includes(u));
                    const vpnTag = vpnIPs.has(ip) ? ' 🔒 VPN' : datacenterIPs.has(ip) ? ' 🏢 DC' : '';
                    return `\`${maskIP(ip)}\` → ${usersOnIp.length} users${vpnTag}`;
                }).join('\n') || '*No shared IPs found*';

                // ── Confidence bar ──
                const confFilled = Math.round(confidence / 10);
                const confBar = '🟥'.repeat(Math.min(confFilled, 10)) + '⬜'.repeat(Math.max(10 - confFilled, 0));

                const embed = new EmbedBuilder()
                    .setTitle(`${title}`)
                    .setColor(color)
                    .setDescription(`**Threat:** ${threatLevel} — **Confidence:** ${confidence}%\n${confBar}`)
                    .addFields(
                        { name: `👤 Accounts (${group.length})`, value: memberLines.slice(0, 1024), inline: false },
                        { name: `🌐 Shared IPs (${sharedIPs.size})`, value: ipAnalysis.slice(0, 1024), inline: false }
                    );

                // Connection evidence
                const evidenceStr = evidence.map(e => `• ${e}`).join('\n');
                embed.addFields(
                    { name: '🔗 Connection Evidence', value: evidenceStr || '*None*', inline: true },
                    { name: '🖥️ Fingerprint', value: hasFPMatch ? `✅ Match — ${sharedFPs.size} shared` : '❌ No match', inline: true },
                    { name: '🌐 Browser', value: sameUA ? '✅ Same device' : '❌ Different', inline: true }
                );

                // Evasion analysis
                if (isEvasion) {
                    const analysis = analyzeEvasion(bannedInGroup, verifiedInGroup, sharedIPs, userToIPs, userLatestUA, userInfo, vpnIPs, datacenterIPs, usersWithVPN, hasFPMatch);
                    embed.addFields({ name: '🔬 Evasion Analysis', value: analysis.explanation.slice(0, 1024), inline: false });
                    if (analysis.action) {
                        embed.addFields({ name: '⚡ Recommended Action', value: analysis.action, inline: false });
                    }
                }

                embeds.push(embed);
            }

            // ── 10. Solo users with VPN (not in any cluster) ──
            const clusteredUsers = new Set();
            for (const group of altGroups) group.forEach(u => clusteredUsers.add(u));

            const soloVPNUsers = [...usersWithVPN].filter(u => !clusteredUsers.has(u) && verifiedSet.has(u));

            // ── 11. Summary embed ──
            const totalUsers = allUsers.size;
            const totalVerified = verifiedSet.size;
            const totalBanned = bannedUserIds.size;

            const summaryEmbed = new EmbedBuilder()
                .setTitle('📊 Alt-Account Diagnostic Report')
                .setColor(detectedEvaders > 0 ? 0xe74c3c : altGroups.length > 0 ? 0xf39c12 : 0x2ecc71)
                .setDescription(`Full scan of guild \`${targetGuild}\`\nVPN Database: ${vpnDetector.ready ? `✅ ${vpnDetector.stats().vpnRanges + vpnDetector.stats().datacenterRanges} ranges loaded` : '⚠️ Not loaded'}`)
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.tag}` });

            // Stats overview
            summaryEmbed.addFields(
                { name: '📁 Records', value: `\`${ipRows.length}\` IPs stored`, inline: true },
                { name: '👤 Users', value: `\`${totalUsers}\` unique`, inline: true },
                { name: '✅ Verified', value: `\`${totalVerified}\``, inline: true },
                { name: '🔨 Banned', value: `\`${totalBanned}\` active`, inline: true },
                { name: '🔗 Alt Clusters', value: `\`${altGroups.length}\` found`, inline: true },
                { name: '🚨 Evasions', value: `\`${detectedEvaders}\``, inline: true }
            );

            // VPN stats
            summaryEmbed.addFields(
                { name: '🔒 VPN/Proxy IPs', value: `\`${vpnIPs.size}\` detected`, inline: true },
                { name: '🏢 Datacenter IPs', value: `\`${datacenterIPs.size}\` detected`, inline: true },
                { name: '👤 Users w/ VPN', value: `\`${usersWithVPN.size}\` total`, inline: true }
            );

            // Threat breakdown
            if (altGroups.length > 0) {
                const threatLines = [];
                if (threatBreakdown.critical > 0) threatLines.push(`🔴 **Critical:** ${threatBreakdown.critical} cluster(s)`);
                if (threatBreakdown.high > 0) threatLines.push(`🟠 **High:** ${threatBreakdown.high} cluster(s)`);
                if (threatBreakdown.medium > 0) threatLines.push(`🟡 **Medium:** ${threatBreakdown.medium} cluster(s)`);
                if (threatBreakdown.low > 0) threatLines.push(`🔵 **Low:** ${threatBreakdown.low} cluster(s)`);
                summaryEmbed.addFields({ name: '🎯 Threat Breakdown', value: threatLines.join('\n'), inline: false });
            }

            // Solo VPN users warning
            if (soloVPNUsers.length > 0) {
                const vpnList = soloVPNUsers.slice(0, 10).map(uid => {
                    const info = userInfo[uid] || {};
                    if (!info.tag) {
                        // Fetch quick info
                        return `• \`${uid}\` — VPN user (not in cluster)`;
                    }
                    return `• **${info.tag}** (\`${uid}\`)`;
                }).join('\n');
                const extra = soloVPNUsers.length > 10 ? `\n*…and ${soloVPNUsers.length - 10} more*` : '';
                summaryEmbed.addFields({ name: `🔒 Solo VPN Users (${soloVPNUsers.length})`, value: (vpnList + extra).slice(0, 1024), inline: false });
            }

            // Health check
            const healthChecks = [
                vpnDetector.ready ? '✅ VPN Detection: Active' : '❌ VPN Detection: Not loaded',
                ipRows.some(r => r.fingerprint) ? '✅ Fingerprinting: Capturing data' : '⚠️ Fingerprinting: No data captured',
                altGroups.length === 0 ? '✅ No alt clusters detected' : `⚠️ ${altGroups.length} alt cluster(s) found`,
                detectedEvaders === 0 ? '✅ No ban evasions detected' : `🚨 ${detectedEvaders} ban evasion(s) found`
            ];
            summaryEmbed.addFields({ name: '🏥 System Health', value: healthChecks.join('\n'), inline: false });

            // ── 12. Send paginated ──
            const allEmbeds = [summaryEmbed, ...embeds];
            const firstBatch = allEmbeds.slice(0, 10);
            await interaction.editReply({ content: null, embeds: firstBatch });

            for (let i = 10; i < allEmbeds.length; i += 10) {
                const batch = allEmbeds.slice(i, i + 10);
                await interaction.followUp({ embeds: batch, flags: 64 });
            }

        } catch (error) {
            console.error('[CHECKALTS] Error:', error);
            await interaction.editReply({ content: `❌ Error running diagnostic: ${error.message}` });
        }
    }
};

// ═══════════════════════════════════════════
// Helper: Mask IP for privacy (show first 2 octets)
// ═══════════════════════════════════════════
function maskIP(ip) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
    return ip.slice(0, 8) + '…';
}

// ═══════════════════════════════════════════
// Helper: Focused report on a single user
// ═══════════════════════════════════════════
async function sendUserFocusReport(interaction, userId, ctx) {
    const {
        userToIPs, ipToUsers, fpToUsers, userToFPs, userInfo, bannedUserIds, bannedByTag,
        verifiedSet, verifiedAtMap, userLatestUA, userLatestTime, userRiskScores,
        ipRows, targetGuild, vpnIPs, datacenterIPs, usersWithVPN
    } = ctx;

    const info = userInfo[userId] || {};
    const userIPs = userToIPs[userId] ? [...userToIPs[userId]] : [];

    // Find all connected accounts (DFS through IP + fingerprint chains)
    const connected = new Set();
    const visited = new Set();
    function dfs(uid) {
        if (visited.has(uid)) return;
        visited.add(uid);
        connected.add(uid);
        const ips = userToIPs[uid] || new Set();
        for (const ip of ips) {
            const users = ipToUsers[ip] || new Set();
            for (const u of users) dfs(u);
        }
        const fps = userToFPs[uid] || new Set();
        for (const fp of fps) {
            const users = fpToUsers[fp] || new Set();
            for (const u of users) dfs(u);
        }
    }
    dfs(userId);
    connected.delete(userId);

    // All IP records for this user
    const userRecords = ipRows.filter(r => r.userid === userId);

    // ── Embed 1: User Profile ──
    const isBanned = bannedUserIds.has(userId);
    const isVerified = verifiedSet.has(userId);
    const hasVPN = usersWithVPN.has(userId);
    const riskScore = userRiskScores[userId] || 0;

    const profileColor = isBanned ? 0xe74c3c : hasVPN && connected.size > 0 ? 0xe67e22 : hasVPN ? 0xf39c12 : isVerified ? 0x2ecc71 : 0x95a5a6;

    // Status line
    const statusFlags = [];
    if (isBanned) statusFlags.push('🔨 **BANNED**');
    if (isVerified) statusFlags.push('✅ Verified');
    if (hasVPN) statusFlags.push('🔒 VPN User');
    if (connected.size > 0) statusFlags.push(`🔗 ${connected.size} linked account(s)`);
    if (info.daysOld !== null && info.daysOld < 30) statusFlags.push(`🆕 New account (${info.daysOld}d)`);

    const profileEmbed = new EmbedBuilder()
        .setTitle(`🔍 User Diagnostic: ${info.tag || userId}`)
        .setColor(profileColor)
        .setDescription(statusFlags.join(' • ') || '*No flags*')
        .setTimestamp()
        .setFooter({ text: `Guild: ${targetGuild}` });

    // Security checks
    const checks = [
        `${info.daysOld !== null && info.daysOld >= 90 ? '✅' : info.daysOld !== null && info.daysOld >= 30 ? '🟡' : '🔴'} Account Age: **${info.daysOld !== null ? info.daysOld + ' days' : 'Unknown'}**`,
        `${info.avatar ? '✅' : '⚠️'} Avatar: **${info.avatar ? 'Custom' : 'Default'}**`,
        `${isVerified ? '✅' : '❌'} Verified: **${isVerified ? 'Yes' : 'No'}**`,
        `${!isBanned ? '✅' : '🔴'} Ban Status: **${isBanned ? `Banned — ${bannedByTag[userId]?.reason || 'No reason'}` : 'Clean'}**`,
        `${!hasVPN ? '✅' : '🔴'} VPN/Proxy: **${hasVPN ? 'Detected' : 'Not detected'}**`,
        `${connected.size === 0 ? '✅' : '🔴'} Linked Accounts: **${connected.size > 0 ? `${connected.size} found` : 'None'}**`
    ];
    profileEmbed.addFields({ name: '🔍 Security Checks', value: checks.join('\n'), inline: false });

    // Risk score bar
    const score = Math.min(riskScore, 100);
    const filled = Math.round(score / 10);
    const bar = '🟥'.repeat(Math.min(filled, 10)) + '⬜'.repeat(Math.max(10 - filled, 0));
    const riskLevel = score >= 70 ? 'CRITICAL' : score >= 40 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW';
    profileEmbed.addFields({ name: '📊 Risk Score', value: `${bar} **${score}/100** (${riskLevel})`, inline: false });

    // ── IP Details ──
    const ipDetails = userIPs.map(ip => {
        const others = [...(ipToUsers[ip] || [])].filter(u => u !== userId);
        const vpnTag = vpnIPs.has(ip) ? ' 🔒 **VPN**' : datacenterIPs.has(ip) ? ' 🏢 **DC**' : ' ✅';
        const othersStr = others.length > 0
            ? others.slice(0, 5).map(u => {
                const uInfo = userInfo[u] || {};
                const badge = bannedUserIds.has(u) ? ' 🔨' : verifiedSet.has(u) ? ' ✅' : '';
                return `${uInfo.tag || u}${badge}`;
            }).join(', ') + (others.length > 5 ? ` +${others.length - 5} more` : '')
            : '*Solo — no other users*';
        return `\`${maskIP(ip)}\`${vpnTag}\n> Shared with: ${othersStr}`;
    }).join('\n') || '*No IPs recorded*';

    profileEmbed.addFields({ name: `🌐 IP Addresses (${userIPs.length})`, value: ipDetails.slice(0, 1024), inline: false });

    // ── Connected accounts ──
    const embeds = [profileEmbed];

    if (connected.size > 0) {
        const connEmbed = new EmbedBuilder()
            .setTitle(`🔗 Linked Accounts for ${info.tag || userId}`)
            .setColor(profileColor);

        // Sort: banned first, then by risk
        const sortedConn = [...connected].sort((a, b) => {
            if (bannedUserIds.has(a) && !bannedUserIds.has(b)) return -1;
            if (!bannedUserIds.has(a) && bannedUserIds.has(b)) return 1;
            return (userRiskScores[b] || 0) - (userRiskScores[a] || 0);
        });

        const connLines = sortedConn.slice(0, 15).map(uid => {
            const ci = userInfo[uid] || {};
            const tags = [];
            if (bannedUserIds.has(uid)) tags.push('🔨 BAN');
            if (verifiedSet.has(uid)) tags.push('✅');
            if (usersWithVPN.has(uid)) tags.push('🔒 VPN');
            if (ci.daysOld !== null && ci.daysOld < 30) tags.push(`🆕 ${ci.daysOld}d`);

            // How are they connected?
            const myIPs = userToIPs[userId] || new Set();
            const theirIPs = userToIPs[uid] || new Set();
            const sharedIPCount = [...myIPs].filter(ip => theirIPs.has(ip)).length;

            const myFPs = userToFPs[userId] || new Set();
            const theirFPs = userToFPs[uid] || new Set();
            const sharedFPCount = [...myFPs].filter(fp => theirFPs.has(fp)).length;

            const connType = [];
            if (sharedIPCount > 0) connType.push(`${sharedIPCount} IP(s)`);
            if (sharedFPCount > 0) connType.push(`${sharedFPCount} FP(s)`);
            const connStr = connType.length > 0 ? ` — via ${connType.join(' + ')}` : ' — indirect link';

            return `> **${ci.tag || uid}** ${tags.join(' ')}\n> \`${uid}\`${connStr}`;
        }).join('\n');

        const extra = connected.size > 15 ? `\n*…and ${connected.size - 15} more linked accounts*` : '';
        connEmbed.setDescription((connLines + extra).slice(0, 4096));

        // Threat assessment for this user
        const linkedBanned = sortedConn.filter(u => bannedUserIds.has(u));
        const linkedWithVPN = sortedConn.filter(u => usersWithVPN.has(u));

        const assessment = [];
        if (linkedBanned.length > 0 && isVerified) {
            assessment.push(`🚨 **This user is likely a ban evasion alt.** Linked to ${linkedBanned.length} banned account(s).`);
        } else if (linkedBanned.length > 0) {
            assessment.push(`⚠️ Linked to ${linkedBanned.length} banned account(s) but not currently verified.`);
        }
        if (hasVPN && linkedBanned.length > 0) {
            assessment.push('🔒 Using VPN while linked to banned accounts — strong indicator of evasion.');
        }
        if (linkedWithVPN.length > 1) {
            assessment.push(`🔒 ${linkedWithVPN.length} accounts in this cluster use VPN/Proxy.`);
        }

        if (assessment.length > 0) {
            connEmbed.addFields({ name: '⚡ Assessment', value: assessment.join('\n'), inline: false });
        }

        embeds.push(connEmbed);
    }

    // ── Verification Timeline ──
    if (userRecords.length > 0) {
        const timeEmbed = new EmbedBuilder()
            .setTitle(`📅 Verification Timeline: ${info.tag || userId}`)
            .setColor(0x95a5a6);

        const timeline = userRecords.slice(0, 15).map(r => {
            const date = new Date(parseInt(r.timestamp)).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
            const vpnTag = vpnIPs.has(r.ip_address) ? ' 🔒 VPN' : datacenterIPs.has(r.ip_address) ? ' 🏢 DC' : '';
            const risk = r.risk_score ? ` — Risk: ${r.risk_score}` : '';
            return `\`${date}\` IP: \`${maskIP(r.ip_address || '?')}\`${vpnTag}${risk}`;
        }).join('\n');

        timeEmbed.setDescription(timeline.slice(0, 4096));

        // User-Agent info
        if (userLatestUA[userId]) {
            const ua = simplifyUA(userLatestUA[userId]);
            timeEmbed.addFields({ name: '🌐 Latest Browser', value: `\`${ua || userLatestUA[userId].slice(0, 100)}\``, inline: false });
        }

        embeds.push(timeEmbed);
    }

    await interaction.editReply({ content: null, embeds: embeds.slice(0, 10) });
    for (let i = 10; i < embeds.length; i += 10) {
        await interaction.followUp({ embeds: embeds.slice(i, i + 10), flags: 64 });
    }
}

// ═══════════════════════════════════════════
// Helper: Analyze ban evasion pattern
// ═══════════════════════════════════════════
function analyzeEvasion(bannedUsers, verifiedUsers, sharedIPs, userToIPs, userLatestUA, userInfo, vpnIPs, datacenterIPs, usersWithVPN, hasFPMatch) {
    const points = [];
    let action = '';

    // Check IP overlap
    const bannedIPSet = new Set();
    bannedUsers.forEach(u => { (userToIPs[u] || new Set()).forEach(ip => bannedIPSet.add(ip)); });
    const verifiedIPSet = new Set();
    verifiedUsers.forEach(u => { (userToIPs[u] || new Set()).forEach(ip => verifiedIPSet.add(ip)); });
    const overlap = [...bannedIPSet].filter(ip => verifiedIPSet.has(ip));

    if (overlap.length > 0) {
        const vpnOverlap = overlap.filter(ip => vpnIPs.has(ip) || datacenterIPs.has(ip));
        if (vpnOverlap.length > 0) {
            points.push(`🌐 **Same IP detected** — ${overlap.length} overlapping IP(s), ${vpnOverlap.length} through VPN/DC.`);
        } else {
            points.push(`🌐 **Same IP detected** — ${overlap.length} overlapping residential IP(s). Strong evidence.`);
        }
    } else {
        const bannedHasIPs = bannedUsers.some(u => userToIPs[u] && userToIPs[u].size > 0);
        if (!bannedHasIPs) {
            points.push('📌 Banned account has **no IP records** — banned before verification system existed.');
        } else {
            points.push('📌 **Different IPs used** — alt likely used VPN, mobile data, or different network.');
        }
    }

    if (hasFPMatch) {
        points.push('🖥️ **Same device/browser fingerprint** — very strong evidence of same person.');
    }

    // Check user agents
    const bannedUAs = bannedUsers.map(u => simplifyUA(userLatestUA[u] || '')).filter(Boolean);
    const verifiedUAs = verifiedUsers.map(u => simplifyUA(userLatestUA[u] || '')).filter(Boolean);
    const sameUA = bannedUAs.some(ua => verifiedUAs.includes(ua));
    if (sameUA) {
        points.push('🌐 **Same browser type detected** between banned and alt account.');
    }

    // VPN usage
    const altUsesVPN = verifiedUsers.some(u => usersWithVPN.has(u));
    if (altUsesVPN) {
        points.push('🔒 **Alt account used VPN/Proxy** to mask their real IP during verification.');
    }

    // Account age
    const altAges = verifiedUsers.map(u => userInfo[u]?.daysOld).filter(d => d !== null);
    const newAlts = altAges.filter(d => d < 30);
    if (newAlts.length > 0) {
        points.push(`🆕 Alt account was **only ${newAlts[0]} days old** at verification.`);
    }

    // Default avatar
    if (verifiedUsers.some(u => userInfo[u] && !userInfo[u].avatar)) {
        points.push('🖼️ Alt has **default Discord avatar** — typical for throwaway accounts.');
    }

    // Recommended action
    const confidence = (hasFPMatch ? 40 : 0) + (overlap.length > 0 ? 30 : 0) + (sameUA ? 10 : 0) + (altUsesVPN ? 10 : 0) + (newAlts.length > 0 ? 10 : 0);
    if (confidence >= 60) {
        action = `🔨 **Recommended: Ban the alt(s) immediately.** Confidence: ${Math.min(confidence, 100)}%\nAlt user IDs: ${verifiedUsers.map(u => `\`${u}\``).join(', ')}`;
    } else if (confidence >= 30) {
        action = `👁️ **Recommended: Monitor closely.** Confidence: ${Math.min(confidence, 100)}%\nConsider reviewing chat history before taking action.`;
    } else {
        action = `📋 **Low confidence (${confidence}%).** Could be coincidence (shared network, school, etc). Monitor but don't act yet.`;
    }

    if (points.length === 0) {
        points.push('📌 Connection method could not be fully determined. Manual review recommended.');
    }

    return {
        explanation: points.join('\n'),
        action
    };
}

// ═══════════════════════════════════════════
// Helper: Simplify User-Agent
// ═══════════════════════════════════════════
function simplifyUA(ua) {
    if (!ua) return '';
    const match = ua.match(/(Chrome|Firefox|Safari|Edge|Opera|OPR|Brave)[\/\s][\d]+.*?(Windows|Mac OS|Linux|Android|iPhone|iPad)/i);
    if (match) return `${match[1]}/${match[2]}`.toLowerCase();
    return ua.slice(0, 50).toLowerCase();
}
