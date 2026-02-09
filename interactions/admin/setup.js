const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const db = require('../../utils/db.js');
const guildCache = require('../../utils/guildCache.js');
const { success, error } = require('../../utils/embedFactory.js');
const { safeDefer, smartReply } = require('../../utils/interactionHelpers.js');

const setupHome = require('./setup_sections/home.js');
const setupMenus = require('./setup_sections/menus.js'); 
const setupChannels = require('./setup_sections/channels.js');
const setupRoles = require('./setup_sections/roles.js');
const setupPermissions = require('./setup_sections/permissions.js');
const setupAntinuke = require('./setup_sections/antinuke.js');
const setupReset = require('./setup_sections/reset.js');
const ticketSetup = require('../tickets/ticketSetup.js');
const setupAutomod = require('./automod.js'); 
const setupAutomodMain = require('./automod_main.js'); 

module.exports = {
    async execute(interaction) {
        const { customId, guild } = interaction;

        if (customId === 'setup_prefix') {
            const modal = new ModalBuilder().setCustomId('modal_setup_prefix').setTitle('Change Server Prefix');
            const prefixInput = new TextInputBuilder().setCustomId('prefix_input').setLabel("New Prefix (Max 3 chars)").setStyle(TextInputStyle.Short).setPlaceholder('!, ., ?, kb!, etc.').setMaxLength(3).setRequired(true);
            const row = new ActionRowBuilder().addComponents(prefixInput);
            modal.addComponents(row);
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit && interaction.isModalSubmit()) {
            if (customId === 'modal_setup_prefix') {
                if (!await safeDefer(interaction, false, true)) return;
                
                const newPrefix = interaction.fields.getTextInputValue('prefix_input').trim();
                
                if (!newPrefix) return smartReply(interaction, { embeds: [error("Prefix cannot be empty.")] });
                if (newPrefix.length > 3) return smartReply(interaction, { embeds: [error("Prefix must be 3 characters or less.")] });
                if (!/^[a-zA-Z0-9!@#$%^&*\-_+=.?~`]+$/.test(newPrefix)) return smartReply(interaction, { embeds: [error("Prefix contains invalid characters. Use letters, numbers, or: !@#$%^&*-_+=.?~`")] });

                try {
                    await db.query(`INSERT INTO guild_settings (guildid, prefix) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET prefix = $2`, [guild.id, newPrefix]);
                    
                    let cached = guildCache.get(guild.id);
                    if (!cached) cached = { settings: {}, permissions: [] };
                    cached.settings.prefix = newPrefix;
                    guildCache.set(guild.id, cached);

                    if (interaction.message) {
                        const { embed, components } = await setupHome.generateSetupContent(interaction, guild.id);
                        await interaction.message.edit({ embeds: [embed], components }).catch(() => {});
                    }
                    
                    await smartReply(interaction, { embeds: [success(`Prefix successfully changed to: \`${newPrefix}\``)] });
                } catch (err) {
                    console.error(err);
                    await smartReply(interaction, { embeds: [error("Database error.")] });
                }
                return;
            }
            if (customId.startsWith('automod_')) {
                return await setupAutomod(interaction);
            }
        }

       
        const immediateModalSelectors = ['antinuke_threshold_select', 'antinuke_window_select'];
        if (immediateModalSelectors.includes(customId)) {
            return await setupAntinuke(interaction);
        }

        if (!interaction.isModalSubmit() && !interaction.replied && !interaction.deferred) {
            const deferred = await safeDefer(interaction, true); 
            if (!deferred) return; 
        }

        if (customId === 'setup_home' || customId === 'cancel_setup') {
            const { embed, components } = await setupHome.generateSetupContent(interaction, guild.id);
            
           
            await smartReply(interaction, { embeds: [embed], components });
            return;
        }
        
        if (customId === 'setup_tickets_menu' || customId.startsWith('ticket_panel_') || customId.startsWith('tkt_')) {
            return await ticketSetup(interaction);
        }

        if (customId.startsWith('setup_menu_') || customId.startsWith('setup_lockdown') || customId === 'select_lockdown_channels') {
            return await setupMenus(interaction);
        }

        if (customId.startsWith('setup_channels')) {
            return await setupChannels(interaction);
        }

        if (customId === 'setup_automod') {
            return await setupAutomodMain(interaction);
        }

        if (customId.startsWith('setup_autopunishment') || customId.startsWith('automod_') || customId.startsWith('autopunishment_')) {
            return await setupAutomod(interaction);
        }

        if (customId.startsWith('setup_staff') || customId === 'select_staff_roles') {
            return await setupRoles(interaction);
        }

        if (customId.startsWith('setup_perm') || customId.startsWith('select_command_perms') || customId.startsWith('perms_role_select_') || customId === 'select_delete_perm') {
            return await setupPermissions(interaction);
        }

        if (customId.startsWith('setup_antinuke') || customId.startsWith('antinuke_')) {
            return await setupAntinuke(interaction);
        }

        if (customId === 'delete_all_data' || customId === 'confirm_delete_data') {
            return await setupReset(interaction);
        }
    },
};
