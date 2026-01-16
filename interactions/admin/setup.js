const { 
    SlashCommandBuilder, 
    PermissionsBitField 
} = require('discord.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');

const setupHome = require('./setup_sections/home.js');
const setupChannels = require('./setup_sections/channels.js');
const setupRoles = require('./setup_sections/roles.js');
const setupPermissions = require('./setup_sections/permissions.js');
const setupAntinuke = require('./setup_sections/antinuke.js');
const setupReset = require('./setup_sections/reset.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Shows the main setup panel.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    generateSetupContent: setupHome.generateSetupContent,

    async execute(interaction) {
        const { customId } = interaction;

        if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isRoleSelectMenu() && !interaction.isChannelSelectMenu()) {
            if (!await safeDefer(interaction, true)) return;
            const { embed, components } = await setupHome.generateSetupContent(interaction, interaction.guild.id);
            await interaction.editReply({ embeds: [embed], components });
            return;
        }

        if (customId === 'setup_home' || customId === 'setup_back_to_main') {
            if (!await safeDefer(interaction, true)) return;
            const { embed, components } = await setupHome.generateSetupContent(interaction, interaction.guild.id);
            await interaction.editReply({ embeds: [embed], components });
            return;
        }
        
        if (customId === 'cancel_setup') {
            await interaction.deferUpdate(); 
            await interaction.deleteReply().catch(() => {});
            return;
        }

        if (customId.startsWith('setup_channels') || customId.endsWith('_channel') || customId === 'select_delete_channel') {
            return await setupChannels(interaction);
        }

        if (customId.startsWith('setup_staff') || customId === 'select_staff_roles') {
            return await setupRoles(interaction);
        }

        if (customId === 'setup_permissions' || customId.startsWith('setup_perms') || customId.startsWith('select_command_perms') || customId.startsWith('perms_role_select_') || customId === 'select_delete_perm') {
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