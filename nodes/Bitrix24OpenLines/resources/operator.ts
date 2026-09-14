import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { numberProperty, positiveInt } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { chatIdProperty, chatOperation, readChatId } from '../shared/helpers';

const transferProperties: INodeProperties[] = [
	{
		displayName: 'Transfer To',
		name: 'transferTo',
		type: 'options',
		default: 'user',
		options: [
			{ name: 'Operator', value: 'user' },
			{ name: 'Queue of an Open Line', value: 'queue' },
		],
	},
	{ displayName: 'User ID', name: 'userId', type: 'number', required: true, default: 0, displayOptions: { show: { transferTo: ['user'] } }, description: 'The employee who takes the conversation' },
	{
		displayName: 'Open Line Name or ID',
		name: 'queueLineId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getOpenLines' },
		required: true,
		default: '',
		displayOptions: { show: { transferTo: ['queue'] } },
		description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'The conversation goes to the queue of this line',
	},
];

/** USER_ID or QUEUE_ID, never both: Bitrix24 takes the first and ignores the rest. */
function transferTarget(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	if (ctx.getNodeParameter('transferTo', itemIndex) === 'queue') {
		const lineId = Number(ctx.getNodeParameter('queueLineId', itemIndex));
		if (!Number.isInteger(lineId) || lineId <= 0) throw new NodeOperationError(ctx.getNode(), 'Open Line must be picked or given as a positive ID', { itemIndex });
		return { QUEUE_ID: lineId };
	}
	return { USER_ID: positiveInt(ctx, 'userId', itemIndex, 'User ID') };
}

export const operatorResource: Resource = {
	value: 'operator',
	name: 'Operator',
	description: 'What an operator does with a conversation: take, pass on, transfer, finish, mark as spam',
	operations: [
		chatOperation('answer', 'Take', 'Take a dialog as operator', 'Take a waiting conversation for the webhook user as operator', 'imopenlines.operator.answer'),
		chatOperation('skip', 'Skip', 'Pass a dialog to the next operator', 'Pass the conversation on to the next operator in the queue', 'imopenlines.operator.skip'),
		{
			value: 'transfer',
			name: 'Transfer',
			action: 'Transfer a dialog',
			description: 'Transfer a conversation to another operator or to the queue of another open line',
			properties: [chatIdProperty, ...transferProperties],
			async execute(itemIndex) {
				const params: IDataObject = { CHAT_ID: readChatId(this, itemIndex), ...transferTarget(this, itemIndex) };
				const body = await bitrix24Request.call(this, 'imopenlines.operator.transfer', params, { itemIndex });
				return { chatId: params.CHAT_ID, userId: params.USER_ID ?? null, lineId: params.QUEUE_ID ?? null, success: body.result === true };
			},
		},
		chatOperation('finish', 'Finish', 'Finish a dialog as its operator', 'Close a conversation the webhook user handles as operator', 'imopenlines.operator.finish'),
		chatOperation('finishAnother', 'Finish Another Operator\'s', 'Finish a dialog of another operator', 'Close a conversation even though another operator handles it', 'imopenlines.operator.another.finish'),
		chatOperation('markSpam', 'Mark as Spam', 'Mark a dialog as spam', 'Mark a conversation as spam and close it', 'imopenlines.operator.spam'),
	],
};

const crmTypeProperty: INodeProperties = {
	displayName: 'CRM Record Type',
	name: 'crmType',
	type: 'options',
	default: 'deal',
	options: [
		{ name: 'Company', value: 'company' },
		{ name: 'Contact', value: 'contact' },
		{ name: 'Deal', value: 'deal' },
		{ name: 'Lead', value: 'lead' },
	],
};

const crmIdProperty = numberProperty('CRM Record ID', 'crmId', 'ID of the lead, deal, contact or company');

function crmRecord(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	return { CRM_ENTITY_TYPE: ctx.getNodeParameter('crmType', itemIndex) as string, CRM_ENTITY: positiveInt(ctx, 'crmId', itemIndex, 'CRM Record ID') };
}

const optionalChat: INodeProperties = { ...chatIdProperty, required: false, description: 'Leave empty for the latest chat of the record' };

export const crmChatResource: Resource = {
	value: 'crmChat',
	name: 'CRM Chat',
	description: 'Open channel chats linked to a lead, deal, contact or company',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the chats of a CRM record',
			description: 'List the open channel chats of a lead, deal, contact or company with their channels',
			properties: [crmTypeProperty, crmIdProperty, { displayName: 'Active Only', name: 'activeOnly', type: 'boolean', default: true, description: 'Whether to leave out closed chats' }],
			async execute(itemIndex) {
				const params: IDataObject = { ...crmRecord(this, itemIndex), ACTIVE_ONLY: this.getNodeParameter('activeOnly', itemIndex, true) === true ? 'Y' : 'N' };
				const body = await bitrix24Request.call(this, 'imopenlines.crm.chat.get', params, { itemIndex });
				return (Array.isArray(body.result) ? (body.result as IDataObject[]) : []).map((chat) => ({ crmType: params.CRM_ENTITY_TYPE, crmId: params.CRM_ENTITY, ...chat, chatId: Number(chat.CHAT_ID) }));
			},
		},
		{
			value: 'getLastId',
			name: 'Get Latest Chat ID',
			action: 'Get the latest chat of a CRM record',
			description: 'Get the ID of the most recent open channel chat of a lead, deal, contact or company',
			properties: [crmTypeProperty, crmIdProperty],
			async execute(itemIndex) {
				const params = crmRecord(this, itemIndex);
				const body = await bitrix24Request.call(this, 'imopenlines.crm.chat.getLastId', params, { itemIndex });
				const chatId = Number(body.result);
				return { crmType: params.CRM_ENTITY_TYPE, crmId: params.CRM_ENTITY, chatId: chatId > 0 ? chatId : null };
			},
		},
		{
			value: 'addUser',
			name: 'Add User',
			action: 'Add a user to the chat of a CRM record',
			description: 'Add an employee or a bot to the open channel chat of a CRM record',
			properties: [crmTypeProperty, crmIdProperty, numberProperty('User ID', 'userId', 'The employee or bot to add'), optionalChat],
			async execute(itemIndex) {
				const params: IDataObject = { ...crmRecord(this, itemIndex), USER_ID: positiveInt(this, 'userId', itemIndex, 'User ID') };
				if (String(this.getNodeParameter('chatId', itemIndex, '') ?? '').trim() !== '') params.CHAT_ID = readChatId(this, itemIndex);
				const body = await bitrix24Request.call(this, 'imopenlines.crm.chat.user.add', params, { itemIndex });
				const chatId = Number(body.result);
				if (chatId <= 0) throw new NodeOperationError(this.getNode(), 'The CRM record has no open channel chat', { itemIndex });
				return { chatId, userId: params.USER_ID, added: true };
			},
		},
		{
			value: 'removeUser',
			name: 'Remove User',
			action: 'Remove a user from the chat of a CRM record',
			description: 'Take an employee or a bot out of the open channel chat of a CRM record',
			properties: [crmTypeProperty, crmIdProperty, numberProperty('User ID', 'userId', 'The employee or bot to remove'), optionalChat],
			async execute(itemIndex) {
				const params: IDataObject = { ...crmRecord(this, itemIndex), USER_ID: positiveInt(this, 'userId', itemIndex, 'User ID') };
				if (String(this.getNodeParameter('chatId', itemIndex, '') ?? '').trim() !== '') params.CHAT_ID = readChatId(this, itemIndex);
				const body = await bitrix24Request.call(this, 'imopenlines.crm.chat.user.delete', params, { itemIndex });
				const chatId = Number(body.result);
				if (chatId <= 0) throw new NodeOperationError(this.getNode(), 'The CRM record has no open channel chat', { itemIndex });
				return { chatId, userId: params.USER_ID, removed: true };
			},
		},
		{
			value: 'sendMessage',
			name: 'Send Message',
			action: 'Send a message to the client of a CRM record',
			description: 'Write into the open channel chat of a CRM record as an employee or bot who is in that chat; the client receives it in their channel',
			properties: [
				crmTypeProperty,
				crmIdProperty,
				chatIdProperty,
				numberProperty('Sender User ID', 'userId', 'The employee or bot the message comes from; must be in the chat and see the record'),
				{ displayName: 'Text', name: 'text', type: 'string', typeOptions: { rows: 4 }, required: true, default: '' },
			],
			async execute(itemIndex) {
				const text = String(this.getNodeParameter('text', itemIndex) ?? '');
				if (text.trim() === '') throw new NodeOperationError(this.getNode(), 'Text is required', { itemIndex });
				const params = { ...crmRecord(this, itemIndex), CHAT_ID: readChatId(this, itemIndex), USER_ID: positiveInt(this, 'userId', itemIndex, 'Sender User ID'), MESSAGE: text };
				const body = await bitrix24Request.call(this, 'imopenlines.crm.message.add', params, { itemIndex });
				return { chatId: params.CHAT_ID, messageId: Number(body.result) };
			},
		},
	],
};

const botTokenProperty: INodeProperties = {
	displayName: 'Bot Token',
	name: 'botToken',
	type: 'string',
	typeOptions: { password: true },
	default: '',
	description: 'Through a webhook Bitrix24 needs to know which bot acts: the botToken the bot was registered with in imbot.v2, or the CLIENT_ID of an older imbot bot',
};

function withBotToken(ctx: IExecuteFunctions, itemIndex: number, params: IDataObject): IDataObject {
	const token = String(ctx.getNodeParameter('botToken', itemIndex, '') ?? '').trim();
	return token === '' ? params : { ...params, CLIENT_ID: token };
}

export const botDialogResource: Resource = {
	value: 'botDialog',
	name: 'Bot Dialog',
	description: 'What a chatbot connected to an open line does with a conversation',
	operations: [
		{
			value: 'sendMessage',
			name: 'Send Automatic Message',
			action: 'Send an automatic bot message',
			description: 'Send the line\'s welcome message or a text of your own into a conversation on behalf of its bot',
			properties: [
				chatIdProperty,
				{
					displayName: 'Message',
					name: 'kind',
					type: 'options',
					default: 'DEFAULT',
					options: [
						{ name: 'Text', value: 'DEFAULT' },
						{ name: 'Welcome Message of the Line', value: 'WELCOME' },
					],
				},
				{ displayName: 'Text', name: 'text', type: 'string', typeOptions: { rows: 3 }, required: true, default: '', displayOptions: { show: { kind: ['DEFAULT'] } } },
				botTokenProperty,
			],
			async execute(itemIndex) {
				const kind = this.getNodeParameter('kind', itemIndex) as string;
				const params: IDataObject = { CHAT_ID: readChatId(this, itemIndex), NAME: kind };
				if (kind === 'DEFAULT') {
					const text = String(this.getNodeParameter('text', itemIndex) ?? '');
					if (text.trim() === '') throw new NodeOperationError(this.getNode(), 'Text is required', { itemIndex, description: 'Bitrix24 answers true and adds nothing for an empty text.' });
					params.MESSAGE = text;
				}
				const body = await bitrix24Request.call(this, 'imopenlines.bot.session.message.send', withBotToken(this, itemIndex, params), { itemIndex });
				return { chatId: params.CHAT_ID, accepted: body.result === true };
			},
		},
		{
			value: 'toOperator',
			name: 'Hand to Free Operator',
			action: 'Hand a bot dialog to a free operator',
			description: 'Pass the conversation from the bot to the first free operator of the line',
			properties: [chatIdProperty, botTokenProperty],
			async execute(itemIndex) {
				const params = withBotToken(this, itemIndex, { CHAT_ID: readChatId(this, itemIndex) });
				const body = await bitrix24Request.call(this, 'imopenlines.bot.session.operator', params, { itemIndex });
				return { chatId: params.CHAT_ID, success: body.result === true };
			},
		},
		{
			value: 'transfer',
			name: 'Transfer',
			action: 'Transfer a bot dialog',
			description: 'Transfer the conversation from the bot to a given operator or to the queue of a line',
			properties: [
				chatIdProperty,
				...transferProperties,
				{ displayName: 'Bot Leaves at Once', name: 'leave', type: 'boolean', default: false, description: 'Whether the bot leaves the chat right away instead of staying until the transfer is accepted' },
				{ ...botTokenProperty, required: true },
			],
			async execute(itemIndex) {
				const params: IDataObject = { CHAT_ID: readChatId(this, itemIndex), ...transferTarget(this, itemIndex), LEAVE: this.getNodeParameter('leave', itemIndex, false) === true ? 'Y' : 'N' };
				const body = await bitrix24Request.call(this, 'imopenlines.bot.session.transfer', withBotToken(this, itemIndex, params), { itemIndex });
				return { chatId: params.CHAT_ID, userId: params.USER_ID ?? null, lineId: params.QUEUE_ID ?? null, success: body.result === true };
			},
		},
		{
			value: 'finish',
			name: 'Finish',
			action: 'Finish a bot dialog',
			description: 'Close the current conversation on behalf of the bot',
			properties: [chatIdProperty, { ...botTokenProperty, required: true }],
			async execute(itemIndex) {
				const params = withBotToken(this, itemIndex, { CHAT_ID: readChatId(this, itemIndex) });
				const body = await bitrix24Request.call(this, 'imopenlines.bot.session.finish', params, { itemIndex });
				return { chatId: params.CHAT_ID, success: body.result === true };
			},
		},
	],
};

