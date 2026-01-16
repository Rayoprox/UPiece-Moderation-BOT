const universalPanel = require('../interactions/admin/universalPanel');
const setupSystem = require('../interactions/admin/setup');
const ticketSetup = require('../interactions/tickets/ticketSetup'); 
const automodSystem = require('../interactions/admin/automod');
const appealSystem = require('../interactions/features/appeals');
const logSystem = require('../interactions/moderation/logs');

const { handleTicketOpen } = require('../interactions/tickets/ticketHandler');
const { handleTicketActions } = require('../interactions/tickets/ticketActions'); 

module.exports = async (interaction) => {
    const { customId, client } = interaction;

    if (customId.startsWith('univ_')) {
        return await universalPanel(interaction);
    }

    if (customId.startsWith('automod_') || customId === 'setup_automod') {
        return await automodSystem(interaction);
    }
    
    if (customId === 'setup_tickets_menu' || customId.startsWith('ticket_panel_') || customId.startsWith('tkt_')) {
        return await ticketSetup(interaction);
    }

    const isSetup = customId.startsWith('setup_');
    const isSelect = customId.startsWith('select_');
    const isReset = customId === 'delete_all_data' || customId === 'confirm_delete_data' || customId === 'cancel_setup';
    const isAntinuke = customId.startsWith('antinuke_');
    const isPermsRole = customId.startsWith('perms_role_select_');

    if (isSetup || isSelect || isReset || isAntinuke || isPermsRole) {
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
};