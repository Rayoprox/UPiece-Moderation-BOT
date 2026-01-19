const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');

const setupHome = require('./setup_sections/home.js');
const setupMenus = require('./setup_sections/menus.js'); 
const setupChannels = require('./setup_sections/channels.js');
const setupRoles = require('./setup_sections/roles.js');
const setupPermissions = require('./setup_sections/permissions.js');
const setupAntinuke = require('./setup_sections/antinuke.js');
const setupReset = require('./setup_sections/reset.js');
const ticketSetup = require('../tickets/ticketSetup.js');

const setupAutomod = require('./automod.js'); 

module.exports = {
    async execute(interaction) {
        const { customId } = interaction;

        if (customId === 'setup_home') {
            if (!await safeDefer(interaction, true)) return;
            const { embed, components } = await setupHome.generateSetupContent(interaction, interaction.guild.id);
            await interaction.editReply({ embeds: [embed], components });
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

        if (customId.startsWith('setup_automod') || customId.startsWith('automod_')) {
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