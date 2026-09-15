import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { CHATBOT_CREDENTIAL } from '../../shared/transport';
import { loadOptions } from '../Bitrix24Chatbot/methods';
import { botIdProperty, botRequest } from '../Bitrix24Chatbot/shared/bot';
import { BOT_EVENT_PAGE, BOT_EVENTS, readBotEvents } from '../Bitrix24Chatbot/shared/events';
import { eventItem } from '../Bitrix24Messenger/shared/events';

/** A runaway guard for one poll: 20 pages of 1000 events. */
const MAX_PAGES_PER_POLL = 20;

interface PollState {
	offset?: number;
	/** The bot the offset belongs to: another bot's queue starts over. */
	botId?: number;
	/** The bot was seen keeping its events for polling. */
	checked?: boolean;
}

/** The dialog an event belongs to, as the Dialog IDs option spells it. */
function dialogOf(item: IDataObject): string {
	const chat = (item.chat ?? {}) as IDataObject;
	if (typeof chat.dialogId === 'string' && chat.dialogId !== '') return chat.dialogId;
	return typeof item.dialogId === 'string' ? item.dialogId : '';
}

/** The person the event is about: the author, the caller of a command, who added the bot. */
function actor(item: IDataObject): IDataObject {
	return (item.user ?? {}) as IDataObject;
}

export class Bitrix24ChatbotTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Chatbot Trigger',
		name: 'bitrix24ChatbotTrigger',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{ ($parameter["events"] || []).length ? $parameter["events"].join(", ") : "Any event" }}',
		description: 'Starts a workflow on messages to a Bitrix24 chatbot, its slash commands, button presses and reactions, by polling; no public URL needed',
		defaults: { name: 'Bitrix24 Chatbot Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CHATBOT_CREDENTIAL, required: true }],
		properties: [
			{
				displayName:
					'The bot must keep its events for polling (Event Delivery: Keep for Polling, the default). Bitrix24 keeps one queue per bot: another workflow or app reading the same bot takes events away from this one.',
				name: 'queueNotice',
				type: 'notice',
				default: '',
			},
			botIdProperty,
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				default: ['ONIMBOTV2MESSAGEADD', 'ONIMBOTV2COMMANDADD'],
				options: BOT_EVENTS,
				description: 'Leave empty for every event',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Dialog IDs',
						name: 'dialogIds',
						type: 'string',
						default: '',
						placeholder: 'chat123, 7',
						description: 'Only events of these conversations: chat123 for a group chat, a user ID for the private chat with that user. Empty for all.',
					},
					{
						displayName: 'Include Events From Bots',
						name: 'includeBots',
						type: 'boolean',
						default: false,
						description: 'Whether to start on messages, commands and reactions of bots, this one included. Off by default, so two bots cannot keep answering each other.',
					},
				],
			},
		],
	};

	methods = { loadOptions };

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const state = this.getWorkflowStaticData('node') as PollState;
		const manual = this.getMode() === 'manual';
		const botId = Number(this.getNodeParameter('botId'));
		if (!Number.isInteger(botId) || botId <= 0) {
			throw new NodeOperationError(this.getNode(), 'Bot: pick a bot or give its numeric ID');
		}
		const wanted = new Set(this.getNodeParameter('events', []) as string[]);
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const dialogs = new Set(
			String(options.dialogIds ?? '')
				.split(',')
				.map((d) => d.trim().toLowerCase())
				.filter((d) => d !== ''),
		);
		const includeBots = options.includeBots === true;

		if (state.botId !== botId) {
			state.botId = botId;
			state.offset = undefined;
			state.checked = false;
		}

		// A bot that posts its events to a URL has nothing in its queue, and polling it would
		// look like silence. Checked once per activation and on every manual run.
		if (state.checked !== true || manual) {
			const body = await botRequest.call(this, 'imbot.v2.Bot.get', { botId });
			const bot = ((body.result as IDataObject | null)?.bot ?? {}) as IDataObject;
			if (bot.eventMode === 'webhook') {
				throw new NodeOperationError(this.getNode(), `Bot ${botId} posts its events to a webhook URL, so there is nothing to poll`, {
					description: 'Switch it with Bitrix24 Chatbot → Bot → Update, Event Delivery: Keep for Polling.',
				});
			}
			if (!manual) state.checked = true;
		}

		// First poll of an active workflow: skip what the queue already holds, so turning
		// the workflow on does not answer a backlog of old messages.
		const firstRun = !manual && state.offset === undefined;

		let offset = manual ? undefined : state.offset || undefined;
		const collected: IDataObject[] = [];
		for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
			const result = await readBotEvents.call(this, botId, offset, BOT_EVENT_PAGE);
			collected.push(...result.events);
			if (result.nextOffset !== undefined) offset = result.nextOffset;
			// A manual run reads one page and confirms nothing, so the events stay for the active workflow.
			if (manual || !result.hasMore || result.events.length === 0) break;
		}
		if (!manual && offset !== undefined) state.offset = offset;
		if (firstRun) {
			state.offset = offset ?? 0;
			return null;
		}

		const items = collected
			.map(eventItem)
			.filter((item) => wanted.size === 0 || wanted.has(String(item.type)))
			.filter((item) => dialogs.size === 0 || dialogs.has(dialogOf(item).toLowerCase()))
			.filter((item) => includeBots || actor(item).bot !== true);

		if (items.length === 0) return null;
		return [items.map((json) => ({ json }))];
	}
}
