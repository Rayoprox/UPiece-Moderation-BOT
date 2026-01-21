const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis, DEVELOPER_IDS } = require('../../utils/config.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    deploy: 'main',
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

        console.log(`\n[4/4] CHECKING CORE FILES`);
        const criticalFiles = [
            'handlers/commandHandler.js',
            'handlers/componentHandler.js',
            'events/messageCreate.js',
            'utils/prefixShim.js',
            'utils/db.js'
        ];

        criticalFiles.forEach(file => {
            const filePath = path.join(__dirname, '../../', file);
            if (!fs.existsSync(filePath)) {
                errors++;
                console.error(`  ❌ MISSING FILE: ${file}`);
            }
        });
        console.log(`  ✅ Core Files Verification Complete.`);

      
        console.log("\n================================================");
        const statusText = errors === 0 ? "ALL SYSTEMS OPERATIONAL" : `${errors} CRITICAL ISSUES DETECTED`;
        console.log(`[DIAGNOSTIC] RESULT: ${statusText}`);
        console.log("================================================\n");

      
        const finalEmbed = new EmbedBuilder()
            .setColor(errors === 0 ? 0x2ECC71 : 0xE74C3C)
            .setDescription(`${errors === 0 ? emojis.success : emojis.error} **Diagnostic Completed.**\nCheck your console logs for the full report.`);

        await interaction.editReply({ content: null, embeds: [finalEmbed] });
    },
};