const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const { SUPREME_IDS } = require('../../utils/config.js');

module.exports = {
    deploy: 'main', // O 'global' si quieres
    data: new SlashCommandBuilder()
        .setName('universalpanel')
        .setDescription('👑 Supreme Control Panel (Restricted Access).'),

    async execute(interaction) {
        // 1. SEGURIDAD EXTREMA: Solo Supremos
        if (!SUPREME_IDS.includes(interaction.user.id)) {
            return interaction.reply({ 
                content: '⛔ **ACCESS DENIED.** You are not authorized to use the Universal Panel.', 
                flags: [MessageFlags.Ephemeral] 
            });
        }

        const guildId = interaction.guild.id;

        // Obtener estado actual del bloqueo
        const res = await db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [guildId]);
        let isLocked = res.rows[0]?.universal_lock || false;

        const embed = new EmbedBuilder()
            .setTitle('👑 Universal Control Panel')
            .setDescription(`Control the absolute permission state of the bot.\n\n**Current State:** ${isLocked ? '🔴 **RESTRICTED (Default NO)**' : '🟢 **DEFAULT (Default YES)**'}`)
            .addFields(
                { name: '🟢 Default YES', value: 'Admins have full access. `/setup` works normally.' },
                { name: '🔴 Default NO', value: 'Admins have **NO** access unless explicitly whitelisted here. Native Discord permissions are ignored.' }
            )
            .setColor(isLocked ? 0xFF0000 : 0x00FF00);

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('univ_toggle_lock')
                .setLabel(isLocked ? 'Switch to: Default YES (Unlock)' : 'Switch to: Default NO (Lockdown)')
                .setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('univ_edit_perms')
                .setLabel('Edit Command Permissions')
                .setStyle(ButtonStyle.Primary)
        );

        const response = await interaction.reply({ 
            embeds: [embed], 
            components: [row1], 
            flags: [MessageFlags.Ephemeral] 
        });

        // Collector para manejar los clics AQUÍ MISMO (más seguro y privado)
        const collector = response.createMessageComponentCollector({ time: 300000 });

        collector.on('collect', async i => {
            if (i.customId === 'univ_toggle_lock') {
                isLocked = !isLocked;
                // Guardar en DB
                await db.query(`INSERT INTO guild_settings (guildid, universal_lock) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET universal_lock = $2`, [guildId, isLocked]);
                
                const newEmbed = EmbedBuilder.from(embed)
                    .setDescription(`Control the absolute permission state of the bot.\n\n**Current State:** ${isLocked ? '🔴 **RESTRICTED (Default NO)**' : '🟢 **DEFAULT (Default YES)**'}`)
                    .setColor(isLocked ? 0xFF0000 : 0x00FF00);
                
                row1.components[0].setLabel(isLocked ? 'Switch to: Default YES' : 'Switch to: Default NO').setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Danger);
                
                await i.update({ embeds: [newEmbed], components: [row1] });
            }

            if (i.customId === 'univ_edit_perms') {
                // Mostrar selector de comandos
                const commands = Array.from(interaction.client.commands.keys()).map(c => ({ label: `/${c}`, value: c }));
                // Discord limita los selects a 25 opciones. Si tienes más, habría que paginar. Asumimos <25 por ahora.
                const cmdMenu = new StringSelectMenuBuilder()
                    .setCustomId('univ_select_cmd')
                    .setPlaceholder('Select a command to force permissions...')
                    .addOptions(commands.slice(0, 25)); // Capamos a 25 por seguridad

                await i.update({ content: 'Select a command to override permissions:', embeds: [], components: [new ActionRowBuilder().addComponents(cmdMenu)] });
            }

            if (i.customId === 'univ_select_cmd') {
                const cmdName = i.values[0];
                const roleMenu = new RoleSelectMenuBuilder()
                    .setCustomId(`univ_role_${cmdName}`)
                    .setPlaceholder(`Select roles allowed to use /${cmdName}`)
                    .setMinValues(0)
                    .setMaxValues(25);
                
                await i.update({ content: `Select Roles for **/${cmdName}** (This creates the Whitelist).`, components: [new ActionRowBuilder().addComponents(roleMenu)] });
            }
        });
        
        
    }
};