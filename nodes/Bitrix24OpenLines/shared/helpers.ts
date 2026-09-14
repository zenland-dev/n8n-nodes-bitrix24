import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { jsonValue } from '../../../shared/params';
import type { Operation } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList, yn } from '../../../shared/values';

/** Open line picker. The description must be this literal for the linter; the rest goes in `hint`. */
export function lineProperty(hint = 'The open channel'): INodeProperties {
	return {
		displayName: 'Open Line Name or ID',
		name: 'lineId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getOpenLines' },
		required: true,
		default: '',
		description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint,
	};
}

export function readLineId(ctx: IExecuteFunctions, itemIndex: number, name = 'lineId'): number {
	const id = Number(ctx.getNodeParameter(name, itemIndex));
	if (!Number.isInteger(id) || id <= 0) throw new NodeOperationError(ctx.getNode(), 'Open Line must be picked or given as a positive ID', { itemIndex });
	return id;
}

/** An open channel chat, by number; `chat123` is accepted too. */
export const chatIdProperty: INodeProperties = {
	displayName: 'Chat ID',
	name: 'chatId',
	type: 'string',
	required: true,
	default: '',
	placeholder: '2043',
	description: 'The open channel chat: a number, or chat2043. The CRM Chat and Dialog operations find it.',
};

export function readChatId(ctx: IExecuteFunctions, itemIndex: number, name = 'chatId', label = 'Chat ID'): number {
	const text = String(ctx.getNodeParameter(name, itemIndex) ?? '').trim().replace(/^chat/i, '');
	const id = Number(text);
	if (!Number.isInteger(id) || id <= 0) throw new NodeOperationError(ctx.getNode(), `${label} must be a chat number such as 2043 or chat2043`, { itemIndex });
	return id;
}

const DAYS = [
	{ name: 'Friday', value: 'FR' },
	{ name: 'Monday', value: 'MO' },
	{ name: 'Saturday', value: 'SA' },
	{ name: 'Sunday', value: 'SU' },
	{ name: 'Thursday', value: 'TH' },
	{ name: 'Tuesday', value: 'TU' },
	{ name: 'Wednesday', value: 'WE' },
];

/** The line settings people actually change; everything else goes through Other Settings (JSON). */
export function lineSettings(withName: boolean): INodeProperties[] {
	const options: INodeProperties[] = [
		{ displayName: 'Active', name: 'active', type: 'boolean', default: true },
		{ displayName: 'Ask for Rating', name: 'vote', type: 'boolean', default: true, description: 'Whether to ask the client to rate the conversation' },
		{ displayName: 'Days Off', name: 'daysOff', type: 'multiOptions', default: [], options: DAYS },
		{ displayName: 'Holidays', name: 'holidays', type: 'string', default: '', placeholder: '01.01,08.03', description: 'Comma-separated DD.MM dates' },
		{ displayName: 'Language', name: 'language', type: 'string', default: '', placeholder: 'en', description: 'Language of the automatic messages' },
		{ displayName: 'Max Dialogs per Operator', name: 'maxChat', type: 'number', default: 0, description: 'How many conversations an operator handles at once; 0 for no limit' },
		{ displayName: 'No Answer Time (Seconds)', name: 'noAnswerTime', type: 'number', default: 0, description: 'After this long without an answer the no-answer rule runs' },
		{
			displayName: 'Operator Shown to Client',
			name: 'operatorData',
			type: 'options',
			default: 'profile',
			options: [
				{ name: 'Hidden', value: 'hide' },
				{ name: 'Profile', value: 'profile', description: 'Name and photo from the employee profile' },
				{ name: 'Queue Settings', value: 'queue', description: 'Name and photo set for the operator in the queue' },
			],
		},
		{ displayName: 'Other Settings (JSON)', name: 'settingsJson', type: 'json', default: '{}', description: 'Any other setting of imopenlines.config.add by its name, e.g. {"CRM_CREATE": "deal", "AUTO_CLOSE_TIME": 86400}. Merged last, so it wins.' },
		{ displayName: 'Queue Department IDs', name: 'queueDepartments', type: 'string', default: '', placeholder: '3, 5', description: 'Departments whose employees take conversations. Replaces the whole queue together with Queue User IDs.' },
		{ displayName: 'Queue Time (Seconds)', name: 'queueTime', type: 'number', default: 0, description: 'How long an operator has before the conversation moves to the next one' },
		{
			displayName: 'Queue Type',
			name: 'queueType',
			type: 'options',
			default: 'evenly',
			options: [
				{ name: 'All at Once', value: 'all', description: 'Offer each conversation to every operator in the queue' },
				{ name: 'Evenly', value: 'evenly', description: 'Spread conversations evenly' },
				{ name: 'Strictly in Order', value: 'strictly', description: 'Always start from the first operator in the queue' },
			],
		},
		{ displayName: 'Queue User IDs', name: 'queueUsers', type: 'string', default: '', placeholder: '1, 15', description: 'Operators who take conversations, in order. Replaces the whole queue together with Queue Department IDs.' },
		{ displayName: 'Search Client in CRM', name: 'crm', type: 'boolean', default: true, description: 'Whether to look the client up in CRM and track the conversation there' },
		{ displayName: 'Send Welcome Message', name: 'welcome', type: 'boolean', default: true },
		{ displayName: 'Time Zone', name: 'timezone', type: 'string', default: '', placeholder: 'Europe/Berlin' },
		{ displayName: 'Welcome Message Text', name: 'welcomeText', type: 'string', typeOptions: { rows: 3 }, default: '' },
		{ displayName: 'Working Hours', name: 'worktime', type: 'boolean', default: true, description: 'Whether the line keeps working hours; set From, To and Time Zone with it' },
		{ displayName: 'Working Hours From', name: 'worktimeFrom', type: 'string', default: '', placeholder: '09:00' },
		{ displayName: 'Working Hours To', name: 'worktimeTo', type: 'string', default: '', placeholder: '18:00' },
	];
	if (withName) options.push({ displayName: 'Name', name: 'name', type: 'string', default: '' });
	return options.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Collection values into the PARAMS object of imopenlines.config.add and update. */
export function lineParams(ctx: IExecuteFunctions, o: IDataObject, itemIndex: number): IDataObject {
	const params: IDataObject = {};
	if (typeof o.name === 'string' && o.name.trim() !== '') params.LINE_NAME = o.name.trim();
	for (const [key, field] of [
		['active', 'ACTIVE'],
		['crm', 'CRM'],
		['vote', 'VOTE_MESSAGE'],
		['welcome', 'WELCOME_MESSAGE'],
		['worktime', 'WORKTIME_ENABLE'],
	] as const) {
		if (o[key] !== undefined) params[field] = yn(o[key]);
	}
	for (const [key, field] of [
		['maxChat', 'MAX_CHAT'],
		['noAnswerTime', 'NO_ANSWER_TIME'],
		['queueTime', 'QUEUE_TIME'],
	] as const) {
		if (o[key] !== undefined && Number.isFinite(Number(o[key])) && Number(o[key]) >= 0) params[field] = Number(o[key]);
	}
	for (const [key, field] of [
		['language', 'LANGUAGE_ID'],
		['operatorData', 'OPERATOR_DATA'],
		['queueType', 'QUEUE_TYPE'],
		['timezone', 'WORKTIME_TIMEZONE'],
		['welcomeText', 'WELCOME_MESSAGE_TEXT'],
		['holidays', 'WORKTIME_HOLIDAYS'],
	] as const) {
		if (typeof o[key] === 'string' && (o[key] as string) !== '') params[field] = o[key] as string;
	}
	for (const [key, field] of [
		['worktimeFrom', 'WORKTIME_FROM'],
		['worktimeTo', 'WORKTIME_TO'],
	] as const) {
		if (typeof o[key] !== 'string' || o[key] === '') continue;
		if (!HH_MM.test(o[key] as string)) throw new NodeOperationError(ctx.getNode(), `${key === 'worktimeFrom' ? 'Working Hours From' : 'Working Hours To'} must be HH:MM, e.g. 09:00`, { itemIndex });
		params[field] = o[key] as string;
	}
	if (Array.isArray(o.daysOff) && o.daysOff.length > 0) params.WORKTIME_DAYOFF = o.daysOff as string[];
	const queue = [
		...idList(ctx, o.queueUsers, 'Queue User IDs', itemIndex).map((id) => ({ ENTITY_TYPE: 'user', ENTITY_ID: String(id) })),
		...idList(ctx, o.queueDepartments, 'Queue Department IDs', itemIndex).map((id) => ({ ENTITY_TYPE: 'department', ENTITY_ID: String(id) })),
	];
	if (queue.length > 0) params.QUEUE = queue;
	const extra = jsonValue<IDataObject>(ctx, o.settingsJson, 'Other Settings (JSON)', itemIndex, {});
	return { ...params, ...extra };
}

/** An operation that takes only the chat and answers true or false. */
export function chatOperation(value: string, name: string, action: string, description: string, method: string): Operation {
	return {
		value,
		name,
		action,
		description,
		properties: [chatIdProperty],
		async execute(itemIndex) {
			const chatId = readChatId(this, itemIndex);
			const body = await bitrix24Request.call(this, method, { CHAT_ID: chatId }, { itemIndex });
			return { chatId, success: body.result === true };
		},
	};
}
