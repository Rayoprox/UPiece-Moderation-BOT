const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis, DEVELOPER_IDS } = require('../../utils/config.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');
const pkg = require('../../package.json');

module.exports = {
    deploy: 'developer',
    data: new SlashCommandBuilder()
        .setName('diagnose')
        .setDescription('Developer: Runs a silent system integrity check (Console Output).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
     
        if (!DEVELOPER_IDS.includes(interaction.user.id)) {
            return interaction.editReply({ content: '⛔ Developer only.' });
        }

      
        await interaction.editReply({ content: `${emojis.loading || '⏳'} **Running silent diagnostics...**` });

        console.log("\n================================================");
        console.log(`[DIAGNOSTIC] STARTING SYSTEM CHECK - ${new Date().toISOString()}`);
        console.log("================================================");

        let errors = 0;

      
        console.log(`\n[1/4] CHECKING COMMANDS (${interaction.client.commands.size} total)`);
        
        interaction.client.commands.forEach((cmd, name) => {
            try {
                if (!cmd.data || !cmd.execute) {
                    throw new Error('Invalid structure (missing data/execute)');
                }
            } catch (err) {
                errors++;
                console.error(`  ❌ FAILED: /${name} - ${err.message}`);
            }
        });
        console.log(`  ✅ Command Structure Verification Complete.`);

    
        console.log(`\n[2/4] CHECKING DATABASE CONNECTIVITY`);
        const tablesToCheck = [
            'modlogs', 'guild_settings', 'licenses', 'generated_licenses', 
            'ticket_panels', 'tickets', 'afk_users'
        ];

        for (const table of tablesToCheck) {
            try {
                await db.query(`SELECT 1 FROM ${table} LIMIT 1`);
            } catch (err) {
                if (err.code === '42P01') {
                    errors++;
                    console.error(`  ❌ MISSING TABLE: ${table}`);
                } else {
                    console.warn(`  ⚠️ WARN: Table '${table}' check: ${err.message}`);
                }
            }
        }
        console.log(`  ✅ Database Schema Verification Complete.`);

      
        console.log(`\n[3/4] CHECKING BOT PERMISSIONS`);
        const requiredPerms = [
            PermissionsBitField.Flags.BanMembers,
            PermissionsBitField.Flags.KickMembers,
            PermissionsBitField.Flags.ManageMessages,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.ManageRoles,
            PermissionsBitField.Flags.ModerateMembers
        ];
        
        const botMember = interaction.guild.members.me;
        const missingPerms = requiredPerms.filter(p => !botMember.permissions.has(p));

        if (missingPerms.length > 0) {
            errors++;
            console.error(`  ❌ MISSING PERMISSIONS: Bot lacks ${missingPerms.length} required permissions.`);
        } else {
            console.log(`  ✅ Bot Permissions Verified.`);
        }

        

      
        console.log(`\n[5/9] ENVIRONMENT`);
        const requiredEnvs = ['DISCORD_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_APPEAL_GUILD_ID'];
        requiredEnvs.forEach(k => {
            if (!process.env[k]) {
                errors++;
                console.error(`  ❌ MISSING ENV: ${k}`);
            } else {
                console.log(`  ✅ ENV: ${k} present`);
            }
        });

        console.log(`\n[6/9] NODE & PROCESS`);
        console.log(`  Node: ${process.version}`);
        console.log(`  Platform: ${process.platform} ${process.arch}`);
        console.log(`  Uptime: ${Math.floor(process.uptime())}s`);
        const mem = process.memoryUsage();
        console.log(`  Memory: RSS ${(mem.rss/1024/1024).toFixed(1)} MB | HeapUsed ${(mem.heapUsed/1024/1024).toFixed(1)} MB`);
        console.log(`  CPU (user/system micros):`, process.cpuUsage());

        console.log(`\n[7/9] PACKAGE VERSIONS`);
        console.log(`  name: ${pkg.name} @ ${pkg.version}`);
        if (pkg.dependencies) {
            Object.entries(pkg.dependencies).slice(0,10).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
        }

        console.log(`\n[8/9] SHARD & CONNECTION`);
        try {
            const wsPing = interaction.client.ws?.ping ?? null;
            console.log(`  WS Ping: ${wsPing} ms`);
            if (interaction.client.shard) {
                console.log(`  Shard Count: ${interaction.client.shard.count}`);
            }
        } catch (err) {
            console.warn(`  ⚠️ Could not read shard/ws info: ${err.message}`);
        }

        console.log(`\n[9/9] DATABASE PING & TABLES`);
        try {
            const t0 = performance.now();
            await db.query('SELECT 1');
            const dt = Math.round(performance.now() - t0);
            console.log(`  ✅ DB ping: ${dt}ms`);
        } catch (err) {
            errors++;
            console.error(`  ❌ DB ping failed: ${err.message}`);
        }

        const criticalFiles = [
            'handlers/commandHandler.js',
            'handlers/componentHandler.js',
            'events/messageCreate.js',
            'utils/prefixShim.js',
            'utils/db.js'
        ];
        console.log(`\n[FILES] Core file checks:`);
        criticalFiles.forEach(file => {
            const filePath = path.join(__dirname, '../../', file);
            if (!fs.existsSync(filePath)) {
                errors++;
                console.error(`  ❌ MISSING FILE: ${file}`);
            } else {
                const stat = fs.statSync(filePath);
                console.log(`  ✅ ${file} (${(stat.size/1024).toFixed(1)} KB)`);
            }
        });

        try {
            console.log(`\n[BOT] Client stats`);
            console.log(`  Guilds (cached): ${interaction.client.guilds.cache.size}`);
            const memberSum = interaction.client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
            console.log(`  Approx total members (cached): ${memberSum}`);
            console.log(`  Commands loaded: ${interaction.client.commands.size}`);
        } catch (err) {
            console.warn(`  ⚠️ Could not read client stats: ${err.message}`);
        }

        console.log("\n================================================");
        const statusText = errors === 0 ? "ALL SYSTEMS OPERATIONAL" : `${errors} ISSUES DETECTED`;
        console.log(`[DIAGNOSTIC] RESULT: ${statusText}`);
        console.log("================================================\n");

        const finalEmbed = new EmbedBuilder()
            .setColor(errors === 0 ? 0x2ECC71 : 0xE74C3C)
            .setTitle(`${errors === 0 ? emojis.success || '✅' : emojis.error || '⛔'} Diagnostic Completed`)
            .setDescription(`Status: **${statusText}**\n\nCheck console/worker logs for the full detailed report.`)
            .addFields(
                { name: 'Summary', value: `Errors detected: ${errors}`, inline: true },
                { name: 'Node', value: process.version, inline: true },
                { name: 'Guilds', value: `${interaction.client.guilds.cache.size}`, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [finalEmbed] });
    },
};
