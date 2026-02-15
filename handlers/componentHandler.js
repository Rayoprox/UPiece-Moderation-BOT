const universalPanel = require('../interactions/admin/universalPanel');
const setupSystem = require('../interactions/admin/setup');
const ticketSetup = require('../interactions/tickets/ticketSetup'); 
const automodSystem = require('../interactions/admin/automod');
const automodMain = require('../interactions/admin/automod_main');
const appealSystem = require('../interactions/features/appeals');
const logSystem = require('../interactions/moderation/logs');
const customCommands = require('../interactions/admin/setup_sections/custom_commands.js');
const { error } = require('../utils/embedFactory.js'); 

const { handleTicketOpen } = require('../interactions/tickets/ticketHandler');
const { handleTicketActions } = require('../interactions/tickets/ticketActions'); 

module.exports = async (interaction) => {
    const { customId, client, user, message } = interaction;

    const PUBLIC_BUTTONS = ['ticket_open_', 'ticket_claim', 'ticket_close', 'start_appeal_process'];
    const isPublic = PUBLIC_BUTTONS.some(id => customId.startsWith(id));

    if (!isPublic) {
        let ownerId = null;

        if (message.interaction) {
            ownerId = message.interaction.user.id;
        } 
        else if (message.mentions && message.mentions.repliedUser) {
            ownerId = message.mentions.repliedUser.id;
        }

        if (ownerId && user.id !== ownerId) {
            return interaction.reply({ 
                content: '⛔ **You cannot use this button.** Run the command yourself.', 
                ephemeral: true 
            });
        }
    }

    try {
        if (customId.startsWith('univ_')) {
            return await universalPanel(interaction);
        }

        if (customId === 'setup_automod') {
            return await automodMain(interaction);
        }

        if (customId === 'automod_anti_mention' || customId === 'automod_anti_spam' || customId.startsWith('automod_antispam_') || customId === 'automod_antimention_roles' || customId === 'automod_antimention_bypass' || customId.startsWith('modal_antispam_')) {
            return await automodMain(interaction);
        }

        if (customId.startsWith('automod_')) {
            return await automodSystem(interaction);
        }
        
        if (customId === 'setup_tickets_menu' || customId.startsWith('ticket_panel_') || customId.startsWith('ticket_multipanel_') || customId.startsWith('tkt_')) {
            return await ticketSetup(interaction);
        }

        if (customId.startsWith('setup_cc_') || customId.startsWith('modal_cc_') || customId.startsWith('select_cc_')) {
            if (interaction.isModalSubmit()) {
                return await customCommands.handleModal(interaction);
            }
            return await customCommands.execute(interaction);
        }


        const isSetup = customId.startsWith('setup_');
        const isSelect = customId.startsWith('select_');
        const isReset = customId === 'delete_all_data' || customId === 'confirm_delete_data' || customId === 'cancel_setup';
        const isAntinuke = customId.startsWith('antinuke_');
        const isPermsRole = customId.startsWith('perm_role_select_') || customId.startsWith('perm_select_ignored_channels_');
        const isSetupModal = customId === 'modal_setup_prefix' || customId === 'modal_prefix_change';
        const isPrefixUI = customId === 'prefix_change' || customId === 'prefix_toggle_delete';

        if (isSetup || isSelect || isReset || isAntinuke || isPermsRole || isSetupModal || isPrefixUI) {
            return await setupSystem.execute(interaction);
        }

        if (customId.startsWith('appeal:') || customId === 'start_appeal_process') return await appealSystem(interaction);
        if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) return await logSystem(interaction);

        if (customId.startsWith('ticket_open_')) {
            await handleTicketOpen(interaction, client);
            return;
        }
        
        if (customId.startsWith('ticket_action_') || customId.startsWith('ticket_close_') || customId.startsWith('ticket_claim_')) {
            await handleTicketActions(interaction, client); 
            return;
        }
    } catch (err) {
       
        if (err.code === 10062 || err.message.includes('Unknown interaction')) {
            console.warn(`[TimeOut Warning] La interacción ${customId} expiró antes de responder.`);
            return;
        }

        console.error("Interaction Error:", err);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
            }
        } catch (replyErr) {
        }
    }
};
