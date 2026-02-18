const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../utils/db.js');
const { DEVELOPER_IDS } = require('../../utils/config.js');

module.exports = {
    deploy: 'developer',
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
        if (!DEVELOPER_IDS.includes(interaction.user.id)) {
            return interaction.editReply({ content: '⛔ Developer only.' });
        }

        const targetGuild = interaction.options.getString('guild') || interaction.guildId;
        const focusUser = interaction.options.getString('user');

        await interaction.editReply({ content: '🔍 **Running full alt-account diagnostic…** This may take a moment.' });

        try {
            // ── 1. Gather all verified user IPs for this guild ──
            const ipRows = (await db.query(
                `SELECT userid, ip_address, user_agent, timestamp, risk_score
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

            // ── 4. Build IP → users map and user → IPs map ──
            const ipToUsers = {};   // ip → Set<userid>
            const userToIPs = {};   // userid → Set<ip>
            const userLatestUA = {}; // userid → latest user_agent
            const userLatestTime = {}; // userid → latest timestamp

            for (const row of ipRows) {
                if (!row.ip_address) continue;
                if (!ipToUsers[row.ip_address]) ipToUsers[row.ip_address] = new Set();
                ipToUsers[row.ip_address].add(row.userid);

                if (!userToIPs[row.userid]) userToIPs[row.userid] = new Set();
                userToIPs[row.userid].add(row.ip_address);

                if (!userLatestTime[row.userid] || row.timestamp > userLatestTime[row.userid]) {
                    userLatestTime[row.userid] = row.timestamp;
                    userLatestUA[row.userid] = row.user_agent;
                }
            }

            // ── 5. Detect alt clusters (users sharing IPs) ──
            // Union-Find to group users connected by shared IPs
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

            // Group into clusters
            const clusters = {};
            const allUsers = new Set(Object.keys(userToIPs));
            for (const uid of allUsers) {
                const root = find(uid);
                if (!clusters[root]) clusters[root] = new Set();
                clusters[root].add(uid);
            }

            // Filter: only clusters with ≥2 members (actual alt groups)
            const altGroups = Object.values(clusters)
                .filter(s => s.size >= 2)
                .map(s => [...s])
                .sort((a, b) => b.length - a.length);

            // ── 6. Fetch Discord user info for relevant users ──
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

            // ── 7. If focusing on a specific user ──
            if (focusUser) {
                return sendUserFocusReport(interaction, focusUser, {
                    userToIPs, ipToUsers, userInfo, bannedUserIds, bannedByTag,
                    verifiedSet, userLatestUA, userLatestTime, ipRows, targetGuild
                });
            }

            // ── 8. Build diagnostic embeds per alt cluster ──
            const embeds = [];
            let detectedEvaders = 0;
            let undetectedEvaders = 0;
            const recommendations = new Set();

            for (const group of altGroups) {
                const hasBanned = group.some(u => bannedUserIds.has(u));
                const hasVerified = group.some(u => verifiedSet.has(u));
                const bannedInGroup = group.filter(u => bannedUserIds.has(u));
                const verifiedInGroup = group.filter(u => verifiedSet.has(u));
                const isEvasion = hasBanned && hasVerified;

                // Shared IPs between members
                const sharedIPs = new Set();
                for (const uid of group) {
                    if (userToIPs[uid]) {
                        for (const ip of userToIPs[uid]) {
                            if (ipToUsers[ip] && ipToUsers[ip].size >= 2) sharedIPs.add(ip);
                        }
                    }
                }

                // Compare user agents
                const agents = {};
                for (const uid of group) {
                    if (userLatestUA[uid]) {
                        const short = simplifyUA(userLatestUA[uid]);
                        if (!agents[short]) agents[short] = [];
                        agents[short].push(uid);
                    }
                }
                const sameUA = Object.values(agents).some(a => a.length >= 2);

                // Check account age patterns
                const ages = group.map(u => userInfo[u]?.daysOld).filter(d => d !== null);
                const hasNewAccount = ages.some(a => a < 30);

                // Build analysis
                let title, color;
                if (isEvasion) {
                    title = '🚨 EVASION DETECTED — Banned User Has Verified Alt';
                    color = 0xe74c3c;
                    undetectedEvaders++;
                } else if (hasBanned) {
                    title = '⚠️ Alt Cluster With Banned User';
                    color = 0xe67e22;
                } else {
                    title = '👥 Shared IP Cluster (No bans)';
                    color = 0x3498db;
                }

                const memberLines = group.map(uid => {
                    const info = userInfo[uid] || {};
                    const flags = [];
                    if (bannedUserIds.has(uid)) flags.push('🔨 BANNED');
                    if (verifiedSet.has(uid)) flags.push('✅ Verified');
                    if (info.daysOld !== null && info.daysOld < 30) flags.push(`🆕 ${info.daysOld}d old`);
                    if (!info.avatar) flags.push('🖼️ No avatar');
                    return `• **${info.tag || uid}** (\`${uid}\`) ${flags.join(' | ')}`;
                }).join('\n');

                const ipLines = [...sharedIPs].map(ip => {
                    const usersOnIp = [...(ipToUsers[ip] || [])].filter(u => group.includes(u));
                    return `\`${ip}\` → ${usersOnIp.length} users`;
                }).join('\n') || 'None visible';

                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setColor(color)
                    .addFields(
                        { name: `Users (${group.length})`, value: memberLines.slice(0, 1024), inline: false },
                        { name: `Shared IPs (${sharedIPs.size})`, value: ipLines.slice(0, 1024), inline: true },
                        { name: 'Same Browser/Device', value: sameUA ? '✅ Yes — same User-Agent detected' : '❌ No — different devices', inline: true }
                    );

                if (isEvasion) {
                    // Explain WHY the system didn't catch it
                    const reasons = analyzeWhyMissed(bannedInGroup, verifiedInGroup, sharedIPs, userToIPs, userLatestUA, userInfo);
                    embed.addFields({ name: '🔬 Why Not Detected?', value: reasons.explanation.slice(0, 1024), inline: false });
                    reasons.recommendations.forEach(r => recommendations.add(r));
                }

                embeds.push(embed);
            }

            // ── 9. Summary embed ──
            const totalUsers = allUsers.size;
            const totalVerified = verifiedSet.size;
            const totalBanned = bannedUserIds.size;

            const summaryEmbed = new EmbedBuilder()
                .setTitle('📊 Alt-Account Diagnostic Report')
                .setColor(undetectedEvaders > 0 ? 0xe74c3c : 0x2ecc71)
                .setDescription(`Guild: \`${targetGuild}\``)
                .addFields(
                    { name: 'Total IP Records', value: `${ipRows.length}`, inline: true },
                    { name: 'Unique Users', value: `${totalUsers}`, inline: true },
                    { name: 'Verified Users', value: `${totalVerified}`, inline: true },
                    { name: 'Active Bans', value: `${totalBanned}`, inline: true },
                    { name: 'Alt Clusters Found', value: `${altGroups.length}`, inline: true },
                    { name: 'Undetected Evasions', value: `${undetectedEvaders}`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.tag}` });

            if (recommendations.size > 0) {
                summaryEmbed.addFields({
                    name: '💡 Recommendations to Improve Detection',
                    value: [...recommendations].map((r, i) => `**${i + 1}.** ${r}`).join('\n').slice(0, 1024),
                    inline: false
                });
            } else if (undetectedEvaders === 0 && altGroups.length === 0) {
                summaryEmbed.addFields({
                    name: '✅ Status',
                    value: 'No alt clusters or evasion detected. System is clean.',
                    inline: false
                });
            }

            // ── 10. Send paginated (max 10 embeds per message) ──
            const allEmbeds = [summaryEmbed, ...embeds];

            // First message: summary + first batch
            const firstBatch = allEmbeds.slice(0, 10);
            await interaction.editReply({ content: null, embeds: firstBatch });

            // Remaining batches as follow-ups
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
// Helper: Focused report on a single user
// ═══════════════════════════════════════════
async function sendUserFocusReport(interaction, userId, ctx) {
    const { userToIPs, ipToUsers, userInfo, bannedUserIds, bannedByTag, verifiedSet, userLatestUA, userLatestTime, ipRows, targetGuild } = ctx;

    const info = userInfo[userId] || {};
    const userIPs = userToIPs[userId] ? [...userToIPs[userId]] : [];

    // Find all connected accounts through IP chain
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
    }
    dfs(userId);
    connected.delete(userId);

    // All IP records for this user
    const userRecords = ipRows.filter(r => r.userid === userId);

    const embed = new EmbedBuilder()
        .setTitle(`🔍 User Focus: ${info.tag || userId}`)
        .setColor(bannedUserIds.has(userId) ? 0xe74c3c : verifiedSet.has(userId) ? 0x2ecc71 : 0x95a5a6)
        .addFields(
            { name: 'User ID', value: `\`${userId}\``, inline: true },
            { name: 'Account Age', value: info.daysOld !== null ? `${info.daysOld} days` : 'Unknown', inline: true },
            { name: 'Has Avatar', value: info.avatar ? 'Yes' : 'No', inline: true },
            { name: 'Banned', value: bannedUserIds.has(userId) ? `Yes — ${bannedByTag[userId]?.reason || 'No reason'}` : 'No', inline: true },
            { name: 'Verified', value: verifiedSet.has(userId) ? 'Yes' : 'No', inline: true },
            { name: 'Latest User-Agent', value: `\`\`\`${(userLatestUA[userId] || 'N/A').slice(0, 200)}\`\`\``, inline: false }
        );

    // IP details
    const ipDetails = userIPs.map(ip => {
        const others = [...(ipToUsers[ip] || [])].filter(u => u !== userId);
        const othersStr = others.length > 0
            ? others.map(u => `${userInfo[u]?.tag || u}${bannedUserIds.has(u) ? ' 🔨' : ''}${verifiedSet.has(u) ? ' ✅' : ''}`).join(', ')
            : 'No other users';
        return `\`${ip}\` → ${othersStr}`;
    }).join('\n') || 'No IPs recorded';

    embed.addFields({ name: `IPs Used (${userIPs.length})`, value: ipDetails.slice(0, 1024), inline: false });

    // Connected accounts
    if (connected.size > 0) {
        const connLines = [...connected].map(uid => {
            const ci = userInfo[uid] || {};
            const flags = [];
            if (bannedUserIds.has(uid)) flags.push('🔨 BANNED');
            if (verifiedSet.has(uid)) flags.push('✅ Verified');
            if (ci.daysOld !== null && ci.daysOld < 30) flags.push(`🆕 ${ci.daysOld}d`);
            return `• **${ci.tag || uid}** (\`${uid}\`) ${flags.join(' | ')}`;
        }).join('\n');

        embed.addFields({ name: `Connected Accounts (${connected.size})`, value: connLines.slice(0, 1024), inline: false });
    }

    // Verification records timeline
    const timeline = userRecords.slice(0, 10).map(r => {
        const date = new Date(parseInt(r.timestamp)).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
        return `\`${date}\` — IP: \`${r.ip_address || '?'}\` — Risk: ${r.risk_score || 0}`;
    }).join('\n') || 'No records';

    embed.addFields({ name: 'Verification Timeline', value: timeline.slice(0, 1024), inline: false });

    await interaction.editReply({ content: null, embeds: [embed] });
}

// ═══════════════════════════════════════════
// Helper: Analyze why system missed an evader
// ═══════════════════════════════════════════
function analyzeWhyMissed(bannedUsers, verifiedUsers, sharedIPs, userToIPs, userLatestUA, userInfo) {
    const explanations = [];
    const recs = [];

    // Check if the banned user had IP records BEFORE the alt verified
    const bannedHasIPs = bannedUsers.some(u => userToIPs[u] && userToIPs[u].size > 0);

    if (!bannedHasIPs) {
        explanations.push('📌 **The banned account had NO IP records.** The ban was issued before the verification system existed, so there was no IP to compare against.');
        recs.push('When banning a user, try to get them to verify first if possible, or manually log their IP. Consider running `/checkalts` periodically.');
    }

    // Check if IPs actually overlap
    const bannedIPs = new Set();
    bannedUsers.forEach(u => { (userToIPs[u] || new Set()).forEach(ip => bannedIPs.add(ip)); });
    const verifiedIPs = new Set();
    verifiedUsers.forEach(u => { (userToIPs[u] || new Set()).forEach(ip => verifiedIPs.add(ip)); });

    const overlap = [...bannedIPs].filter(ip => verifiedIPs.has(ip));

    if (overlap.length === 0 && bannedHasIPs) {
        explanations.push('📌 **No IP overlap.** The alt used a different IP address (VPN, mobile data, different network).');
        recs.push('Consider adding VPN/proxy detection. Free APIs like `ip-api.com` can detect VPN/hosting IPs.');
        recs.push('Add fingerprint-based detection (canvas fingerprint, WebGL hash) to catch users changing IPs.');
    }

    if (overlap.length > 0) {
        explanations.push(`📌 **IPs DO overlap** (\`${overlap.join('`, `')}\`) — the suspicion checker should have flagged this. Possible bug in the checker or the alert threshold was not reached.`);
        recs.push('Review the suspicion score threshold. Currently alerts trigger at score ≥ 40. Consider lowering to 30.');
        recs.push('Check that the verification config has a valid `channel_id` set for alerts.');
    }

    // Check user agent similarity
    const bannedUAs = bannedUsers.map(u => simplifyUA(userLatestUA[u] || '')).filter(Boolean);
    const verifiedUAs = verifiedUsers.map(u => simplifyUA(userLatestUA[u] || '')).filter(Boolean);
    const sameUA = bannedUAs.some(ua => verifiedUAs.includes(ua));

    if (sameUA) {
        explanations.push('📌 **Same browser/device detected** — User-Agent matches between banned and alt account.');
        recs.push('Add User-Agent correlation to the suspicion scoring algorithm (currently not checked).');
    }

    // Check account age
    const altAges = verifiedUsers.map(u => userInfo[u]?.daysOld).filter(d => d !== null);
    const newAlts = altAges.filter(d => d < 30);

    if (newAlts.length > 0) {
        explanations.push(`📌 **Alt account was only ${newAlts[0]} days old.** New accounts are a strong evasion indicator.`);
        if (newAlts[0] >= 7) {
            recs.push('Consider raising the "new account" threshold from 7 days to 14-30 days for higher risk scoring.');
        }
    }

    // Check default avatar
    const noAvatarAlts = verifiedUsers.filter(u => userInfo[u] && !userInfo[u].avatar);
    if (noAvatarAlts.length > 0) {
        explanations.push('📌 **Alt has default Discord avatar** — common with throwaway accounts.');
    }

    if (explanations.length === 0) {
        explanations.push('📌 Could not determine specific bypass reason. Manual review recommended.');
        recs.push('Consider implementing browser fingerprinting for more robust detection.');
    }

    // Generic recommendations always useful
    if (!recs.some(r => r.includes('fingerprint'))) {
        recs.push('Consider implementing canvas/WebGL fingerprinting to detect same browser across different IPs.');
    }

    return {
        explanation: explanations.join('\n\n'),
        recommendations: recs
    };
}

// ═══════════════════════════════════════════
// Helper: Simplify User-Agent to comparable string
// ═══════════════════════════════════════════
function simplifyUA(ua) {
    if (!ua) return '';
    // Extract browser + OS core (removes version numbers)
    const match = ua.match(/(Chrome|Firefox|Safari|Edge|Opera|OPR|Brave)[\/\s][\d]+.*?(Windows|Mac OS|Linux|Android|iPhone|iPad)/i);
    if (match) return `${match[1]}/${match[2]}`.toLowerCase();
    // Fallback: take first 50 chars
    return ua.slice(0, 50).toLowerCase();
}
