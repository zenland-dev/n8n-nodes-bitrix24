import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { normalizeWebhookToken } from '../../credentials/portalAddress';
import { bitrix24Request, WEBHOOK_CREDENTIAL } from '../../shared/transport';
import { EVENT_PAGE, eventItem, MESSENGER_EVENTS, readEvents } from '../Bitrix24Messenger/shared/events';

/** A runaway guard for one poll: 20 pages of 1000 events. */
const MAX_PAGES_PER_POLL = 20;

interface PollState {
	offset?: number;
	subscribed?: boolean;
}

/** The dialog an event belongs to, as the Dialog ID filter spells it. */
function dialogOf(item: IDataObject): string {
	const chat = (item.chat ?? {}) as IDataObject;
	if (typeof chat.dialogId === 'string' && chat.dialogId !== '') return chat.dialogId;
	if (typeof item.dialogId === 'string') return item.dialogId;
	return chat.id !== undefined ? `chat${String(chat.id)}` : '';
}

/** Who caused the event: the message author, or the user in the event. */
function actorOf(item: IDataObject): number {
	const message = (item.message ?? {}) as IDataObject;
	const user = (item.user ?? {}) as IDataObject;
	return Number(message.authorId ?? user.id) || 0;
}

export class Bitrix24MessengerTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Messenger Trigger',
		name: 'bitrix24MessengerTrigger',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{ ($parameter["events"] || []).length ? $parameter["events"].join(", ") : "Any event" }}',
		description: 'Starts a workflow on new, edited or deleted messages in the chats of the Bitrix24 webhook user, by polling; no public URL needed',
		defaults: { name: 'Bitrix24 Messenger Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: WEBHOOK_CREDENTIAL, required: true }],
		properties: [
			{
				displayName:
					'Sees the chats of the user who owns the webhook, and only those. Bitrix24 keeps one event queue per user: a second workflow or app reading the same user takes events away from this one.',
				name: 'queueNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				default: ['ONIMV2MESSAGEADD'],
				options: MESSENGER_EVENTS,
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
						description: 'Only events of these conversations: chat123 for a group chat, a user ID for a private chat. Empty for all.',
					},
					{
						displayName: 'Include Own Events',
						name: 'includeOwn',
						type: 'boolean',
						default: false,
						description: 'Whether to start on messages and reactions of the webhook user too. Off by default, so a workflow that replies does not trigger itself.',
					},
				],
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const state = this.getWorkflowStaticData('node') as PollState;
		const manual = this.getMode() === 'manual';
		const wanted = new Set(this.getNodeParameter('events', []) as string[]);
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const dialogs = new Set(
			String(options.dialogIds ?? '')
				.split(',')
				.map((d) => d.trim().toLowerCase())
				.filter((d) => d !== ''),
		);
		const credentials = await this.getCredentials(WEBHOOK_CREDENTIAL);
		const webhookUserId = Number(normalizeWebhookToken(credentials.webhookToken).split('/')[0]) || 0;
		const includeOwn = options.includeOwn === true;

		// Subscribing is idempotent. Done once per activation, and on every manual run,
		// since a queue without a subscription records nothing and reads empty.
		if (state.subscribed !== true || manual) {
			await bitrix24Request.call(this, 'im.v2.Event.subscribe', {});
			if (!manual) state.subscribed = true;
		}

		// First poll of an active workflow: skip what the queue already holds, so turning
		// the workflow on does not replay a day of old messages.
		const firstRun = !manual && state.offset === undefined;

		let offset = manual ? undefined : state.offset || undefined;
		const collected: IDataObject[] = [];
		for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
			const result = await readEvents.call(this, offset, EVENT_PAGE);
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
			.filter((item) => includeOwn || webhookUserId === 0 || actorOf(item) !== webhookUserId);

		if (items.length === 0) return null;
		return [items.map((json) => ({ json }))];
	}
}
