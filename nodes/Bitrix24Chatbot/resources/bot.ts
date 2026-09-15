import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import type { Bitrix24Context } from '../../../shared/transport';
import { avatarFrom, botIdProperty, botRequest, COLOR_OPTIONS, portalRequest, readBotId, withProfile } from '../shared/bot';

const TYPE_OPTIONS = [
	{ name: 'Bot', value: 'bot', description: 'Gets private messages and mentions in group chats. Right for most bots.' },
	{ name: 'Open Channel Bot', value: 'openline', description: 'Answers clients in open channels; behaves like Bot' },
	{ name: 'Personal Assistant', value: 'personal', description: 'Sees every message of the chats it is in, and can read messages and history. Hidden from search for users without access.' },
	{ name: 'Supervisor', value: 'supervisor', description: 'Sees every message of the chats it is in, and can read messages and history' },
];

const BACKGROUND_OPTIONS = [
	{ name: 'Azure (Dark)', value: 'azure' },
	{ name: 'Cornflower (Dark)', value: 'cornflower' },
	{ name: 'Frost (Light)', value: 'frost' },
	{ name: 'Mint (Dark)', value: 'mint' },
	{ name: 'Peach (Light)', value: 'peach' },
	{ name: 'Sky (Light)', value: 'sky' },
	{ name: 'Slate (Dark)', value: 'slate' },
	{ name: 'Steel (Dark)', value: 'steel' },
	{ name: 'Teal (Dark)', value: 'teal' },
];

/** Largest page Bot.list is asked for. */
const BOT_PAGE = 50;
/** A runaway guard: Bitrix24 allows 100 bots per application. */
const MAX_BOT_PAGES = 20;

/** Every bot of the credential's token, with its user profile. */
export async function listBots(this: Bitrix24Context, filterType: string | undefined, limit: number, itemIndex?: number): Promise<IDataObject[]> {
	const out: IDataObject[] = [];
	for (let page = 0; page < MAX_BOT_PAGES && out.length < limit; page++) {
		const params: IDataObject = { limit: BOT_PAGE, offset: page * BOT_PAGE };
		if (filterType !== undefined) params.filter = { type: filterType };
		const body = await botRequest.call(this, 'imbot.v2.Bot.list', params, itemIndex);
		const result = (body.result ?? {}) as IDataObject;
		const bots = Array.isArray(result.bots) ? (result.bots as IDataObject[]) : [];
		out.push(...bots.map((bot) => withProfile(bot, result.users)));
		if (result.hasNextPage !== true || bots.length === 0) break;
	}
	return out.slice(0, limit);
}

const profileOptions: INodeProperties[] = [
	{ displayName: 'Avatar Binary Field', name: 'avatarBinary', type: 'string', default: '', placeholder: 'data', description: 'Name of the input binary field holding the avatar image, up to 5000×5000 px' },
	{ displayName: 'Chat Background', name: 'backgroundId', type: 'options', default: 'azure', options: BACKGROUND_OPTIONS, description: 'Background of the chat with the bot. Without it, each user\'s own background is shown.' },
	{ displayName: 'Color', name: 'color', type: 'options', default: 'azure', options: COLOR_OPTIONS, description: 'Avatar colour; assigned automatically when not given' },
	{ displayName: 'Gender', name: 'gender', type: 'options', default: 'M', options: [{ name: 'Female', value: 'F' }, { name: 'Male', value: 'M' }] },
	{ displayName: 'Hidden', name: 'isHidden', type: 'boolean', default: false, description: 'Whether to hide the bot from the contact list' },
	{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
	{ displayName: 'Open Channels Support', name: 'isSupportOpenline', type: 'boolean', default: false, description: 'Whether the bot can be connected to open channels' },
	{ displayName: 'Reactions', name: 'isReactionsEnabled', type: 'boolean', default: true, description: 'Whether people can put reactions on the bot\'s messages' },
	{ displayName: 'Work Position', name: 'workPosition', type: 'string', default: '', description: 'Shown in the bot\'s profile, e.g. AI Assistant' },
];

const eventDeliveryOptions: INodeProperties[] = [
	{
		displayName: 'Event Delivery',
		name: 'eventMode',
		type: 'options',
		default: 'fetch',
		options: [
			{ name: 'Keep for Polling', value: 'fetch', description: 'Events wait in the queue for Event → Get Many and the Bitrix24 Chatbot Trigger' },
			{ name: 'Post to Webhook URL', value: 'webhook', description: 'Bitrix24 posts each event to Webhook URL, with an OAuth token of the bot in it; delivery is not retried' },
		],
	},
	{ displayName: 'Webhook URL', name: 'webhookUrl', type: 'string', default: '', placeholder: 'https://n8n.example.com/webhook/…', description: 'Where Bitrix24 posts events when Event Delivery is Post to Webhook URL' },
];

/** Profile, flag and delivery settings of Register and Update, in Bitrix24's shape. */
async function botSettings(ctx: IExecuteFunctions, itemIndex: number, o: IDataObject): Promise<{ fields: IDataObject; properties: IDataObject }> {
	const fields: IDataObject = {};
	const properties: IDataObject = {};
	for (const key of ['name', 'lastName', 'workPosition', 'color', 'gender'] as const) {
		if (o[key] !== undefined && o[key] !== '') properties[key] = o[key];
	}
	const avatar = await avatarFrom(ctx, itemIndex, o.avatarBinary);
	if (avatar !== undefined) properties.avatar = avatar;
	for (const key of ['isHidden', 'isReactionsEnabled', 'isSupportOpenline'] as const) {
		if (o[key] !== undefined) fields[key] = o[key] === true;
	}
	if (o.backgroundId !== undefined) fields.backgroundId = o.backgroundId;

	const url = String(o.webhookUrl ?? '').trim();
	if (url !== '' && !/^https?:\/\/[^\s/]+/i.test(url)) {
		throw new NodeOperationError(ctx.getNode(), 'Webhook URL must be an http or https address', { itemIndex });
	}
	if (o.eventMode === 'webhook' && url === '') {
		throw new NodeOperationError(ctx.getNode(), 'Event Delivery is Post to Webhook URL, but Webhook URL is empty', { itemIndex });
	}
	if (o.eventMode !== undefined) fields.eventMode = o.eventMode;
	if (url !== '') {
		if (o.eventMode === 'fetch') throw new NodeOperationError(ctx.getNode(), 'Webhook URL is used only when Event Delivery is Post to Webhook URL', { itemIndex });
		fields.eventMode = 'webhook';
		fields.webhookUrl = url;
	}
	return { fields, properties };
}

export const botResource: Resource = {
	value: 'bot',
	name: 'Bot',
	description: 'Chatbots registered with the Bot Token of the credential',
	operations: [
		{
			value: 'register',
			name: 'Register',
			action: 'Register a chatbot',
			description: 'Create a chatbot tied to the Bot Token of the credential. Repeating it with the same code returns the existing bot unchanged.',
			properties: [
				{ displayName: 'Code', name: 'code', type: 'string', required: true, default: '', placeholder: 'support_bot', description: 'A unique code for the bot. Registering the same code again returns the bot that already has it.' },
				{ displayName: 'Name', name: 'name', type: 'string', required: true, default: '', description: 'Shown in the chat list and the chat header' },
				{ displayName: 'Type', name: 'type', type: 'options', default: 'bot', options: TYPE_OPTIONS },
				{
					displayName: 'Additional Fields',
					name: 'additionalFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [...profileOptions, ...eventDeliveryOptions].sort((a, b) => a.displayName.localeCompare(b.displayName)),
				},
			],
			async execute(itemIndex) {
				const code = String(this.getNodeParameter('code', itemIndex) ?? '').trim();
				const name = String(this.getNodeParameter('name', itemIndex) ?? '').trim();
				if (code === '' || name === '') throw new NodeOperationError(this.getNode(), 'Code and Name are required', { itemIndex });
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const { fields, properties } = await botSettings(this, itemIndex, { ...o, name });
				const params = { fields: { ...fields, code, type: this.getNodeParameter('type', itemIndex) as string, properties } };
				const body = await botRequest.call(this, 'imbot.v2.Bot.register', params, itemIndex, 'fields');
				const result = (body.result ?? {}) as IDataObject;
				return withProfile(result.bot, result.users);
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a chatbot',
			description: 'Get a bot of this credential with its settings, counters and profile',
			properties: [botIdProperty],
			async execute(itemIndex) {
				const body = await botRequest.call(this, 'imbot.v2.Bot.get', { botId: readBotId(this, itemIndex) }, itemIndex);
				const result = (body.result ?? {}) as IDataObject;
				return withProfile(result.bot, result.users);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get chatbots',
			description: 'List the bots registered with the Bot Token of the credential',
			properties: [
				...returnAllProperties('bots'),
				{ displayName: 'Type', name: 'filterType', type: 'options', default: 'any', options: [{ name: 'Any', value: 'any' }, ...TYPE_OPTIONS.map(({ name, value }) => ({ name, value }))] },
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? Infinity : (this.getNodeParameter('limit', itemIndex) as number);
				const type = this.getNodeParameter('filterType', itemIndex, 'any') as string;
				return await listBots.call(this, type === 'any' ? undefined : type, limit, itemIndex);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a chatbot',
			description: 'Change the name, profile, flags or event delivery of a bot',
			properties: [
				botIdProperty,
				{
					displayName: 'Update Fields',
					name: 'updateFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						// Resetting the background does not work: null, '' and unknown values all left it
						// unchanged on a live portal (15.09.2026), despite the documentation. So no reset option.
						...profileOptions.map((p) => (p.name === 'backgroundId' ? { ...p, description: 'Background of the chat with the bot. Bitrix24 cannot reset it to each user\'s own once set.' } : p)),
						...eventDeliveryOptions,
						{ displayName: 'Name', name: 'name', type: 'string', default: '' },
					].sort((a, b) => a.displayName.localeCompare(b.displayName)) as INodeProperties[],
				},
			],
			async execute(itemIndex) {
				const botId = readBotId(this, itemIndex);
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const { fields, properties } = await botSettings(this, itemIndex, o);
				if (Object.keys(properties).length > 0) fields.properties = properties;
				if (Object.keys(fields).length === 0) throw new NodeOperationError(this.getNode(), 'Nothing to update: add at least one field', { itemIndex });
				const body = await botRequest.call(this, 'imbot.v2.Bot.update', { botId, fields }, itemIndex);
				const result = (body.result ?? {}) as IDataObject;
				return withProfile(result.bot, result.users);
			},
		},
		{
			value: 'unregister',
			name: 'Unregister',
			action: 'Delete a chatbot',
			description: 'Delete a bot with its commands and event subscriptions. The chats it was in stay.',
			properties: [botIdProperty],
			async execute(itemIndex) {
				const botId = readBotId(this, itemIndex);
				const body = await botRequest.call(this, 'imbot.v2.Bot.unregister', { botId }, itemIndex);
				return { botId, unregistered: (body.result as IDataObject | null)?.result === true };
			},
		},
		{
			value: 'getRevision',
			name: 'Get API Revision',
			action: 'Get the chatbot API revision',
			description: 'Get the revision numbers of the REST API and the messenger apps of the portal, to check a feature is there',
			async execute(itemIndex) {
				const body = await portalRequest.call(this, 'imbot.v2.Revision.get', itemIndex);
				return (body.result ?? {}) as IDataObject;
			},
		},
	],
};
