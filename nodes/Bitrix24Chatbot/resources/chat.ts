import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { Resource } from '../../../shared/spec';
import { idList, optionalInt } from '../../../shared/values';
import {
	avatarFrom,
	botIdProperty,
	botRequest,
	COLOR_OPTIONS,
	dialogIdProperty,
	readBotId,
	readDialogId,
	readPositive,
	readUserIds,
} from '../shared/bot';

const userIdsProperty = { displayName: 'User IDs', name: 'userIds', type: 'string' as const, required: true, default: '', placeholder: '7, 12', description: 'Comma-separated user IDs' };

const STATUS_OPTIONS = [
	{ name: 'Analyzing the Request', value: 'IMBOT_AGENT_ACTION_ANALYZING' },
	{ name: 'Calculating', value: 'IMBOT_AGENT_ACTION_CALCULATING' },
	{ name: 'Checking Data', value: 'IMBOT_AGENT_ACTION_CHECKING' },
	{ name: 'Composing a Response', value: 'IMBOT_AGENT_ACTION_COMPOSING' },
	{ name: 'Connecting to the Service', value: 'IMBOT_AGENT_ACTION_CONNECTING' },
	{ name: 'Preparing a Response', value: 'IMBOT_AGENT_ACTION_GENERATING' },
	{ name: 'Processing Data', value: 'IMBOT_AGENT_ACTION_PROCESSING' },
	{ name: 'Reviewing Documents', value: 'IMBOT_AGENT_ACTION_READING_DOCS' },
	{ name: 'Searching for Information', value: 'IMBOT_AGENT_ACTION_SEARCHING' },
	{ name: 'Thinking', value: 'IMBOT_AGENT_ACTION_THINKING' },
	{ name: 'Translating Text', value: 'IMBOT_AGENT_ACTION_TRANSLATING' },
	{ name: 'Typing', value: 'typing', description: 'The standard "typing…" indicator' },
];

function succeeded(body: IDataObject): boolean {
	return (body.result as IDataObject | null)?.result === true;
}

export const chatResource: Resource = {
	value: 'chat',
	name: 'Chat',
	description: 'Group chats the bot creates or is in, and what the bot shows in a chat',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a group chat as the bot',
			description: 'Create a group chat on behalf of the bot, with members and a first message. The bot owns it unless an owner is given.',
			properties: [
				botIdProperty,
				{
					displayName: 'Additional Fields',
					name: 'additionalFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Avatar Binary Field', name: 'avatarBinary', type: 'string', default: '', placeholder: 'data', description: 'Name of the input binary field holding the chat avatar image' },
						{ displayName: 'Color', name: 'color', type: 'options', default: 'azure', options: COLOR_OPTIONS },
						{ displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 2 }, default: '' },
						{ displayName: 'First Message', name: 'message', type: 'string', typeOptions: { rows: 3 }, default: '' },
						{ displayName: 'Member User IDs', name: 'userIds', type: 'string', default: '', placeholder: '7, 12', description: 'Comma-separated IDs of the people to add' },
						{ displayName: 'Owner User ID', name: 'ownerId', type: 'number', default: 0, description: 'Who owns the chat. 0 makes the bot the owner, which Add Managers and Set Owner need.' },
						{ displayName: 'Title', name: 'title', type: 'string', default: '' },
					],
				},
			],
			async execute(itemIndex) {
				const botId = readBotId(this, itemIndex);
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const fields: IDataObject = {};
				for (const key of ['title', 'description', 'color', 'message'] as const) {
					if (o[key] !== undefined && o[key] !== '') fields[key] = o[key];
				}
				// userIds, not users: the documentation warns that users is accepted and silently adds nobody.
				const userIds = o.userIds === undefined ? [] : idList(this, o.userIds, 'Member User IDs', itemIndex);
				if (userIds.length > 0) fields.userIds = userIds;
				if (optionalInt(o.ownerId) !== undefined) fields.ownerId = Number(o.ownerId);
				const avatar = await avatarFrom(this, itemIndex, o.avatarBinary);
				if (avatar !== undefined) fields.avatar = avatar;
				const body = await botRequest.call(this, 'imbot.v2.Chat.add', { botId, fields }, itemIndex);
				const result = (body.result ?? {}) as IDataObject;
				return { ...((result.chat ?? {}) as IDataObject), users: (result.users as IDataObject[] | undefined) ?? [] };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a chat of the bot',
			description: 'Get a chat the bot is in: title, type, owner, managers, last message',
			properties: [botIdProperty, dialogIdProperty()],
			async execute(itemIndex) {
				const body = await botRequest.call(this, 'imbot.v2.Chat.get', { botId: readBotId(this, itemIndex), dialogId: readDialogId(this, itemIndex) }, itemIndex);
				return ((body.result as IDataObject | null)?.chat ?? {}) as IDataObject;
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a chat as the bot',
			description: 'Change the title, description, colour or avatar of a chat the bot is in',
			properties: [
				botIdProperty,
				dialogIdProperty(),
				{
					displayName: 'Update Fields',
					name: 'updateFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Avatar Binary Field', name: 'avatarBinary', type: 'string', default: '', placeholder: 'data', description: 'Name of the input binary field holding the new avatar image' },
						{ displayName: 'Color', name: 'color', type: 'options', default: 'azure', options: COLOR_OPTIONS },
						{ displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 2 }, default: '' },
						{ displayName: 'Title', name: 'title', type: 'string', default: '' },
					],
				},
			],
			async execute(itemIndex) {
				const botId = readBotId(this, itemIndex);
				const dialogId = readDialogId(this, itemIndex);
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const fields: IDataObject = {};
				for (const key of ['title', 'description', 'color'] as const) if (o[key] !== undefined) fields[key] = o[key];
				const avatar = await avatarFrom(this, itemIndex, o.avatarBinary);
				if (avatar !== undefined) fields.avatar = avatar;
				if (Object.keys(fields).length === 0) throw new NodeOperationError(this.getNode(), 'Nothing to update: add at least one field', { itemIndex });
				const body = await botRequest.call(this, 'imbot.v2.Chat.update', { botId, dialogId, fields }, itemIndex);
				return { dialogId, updated: succeeded(body) };
			},
		},
		{
			value: 'leave',
			name: 'Leave',
			action: 'Make the bot leave a chat',
			description: 'Take the bot out of a group chat',
			properties: [botIdProperty, dialogIdProperty('The group chat')],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const body = await botRequest.call(this, 'imbot.v2.Chat.leave', { botId: readBotId(this, itemIndex), dialogId }, itemIndex);
				return { dialogId, left: succeeded(body) };
			},
		},
		{
			value: 'setOwner',
			name: 'Set Owner',
			action: 'Hand a chat of the bot to a new owner',
			description: 'Make another member the owner of a chat the bot owns',
			properties: [botIdProperty, dialogIdProperty('The group chat'), { displayName: 'New Owner User ID', name: 'userId', type: 'number', required: true, default: 0 }],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const userId = readPositive(this, 'userId', itemIndex, 'New Owner User ID');
				const body = await botRequest.call(this, 'imbot.v2.Chat.setOwner', { botId: readBotId(this, itemIndex), dialogId, userId }, itemIndex);
				return { dialogId, ownerId: userId, success: succeeded(body) };
			},
		},
		{
			value: 'addManagers',
			name: 'Add Managers',
			action: 'Make chat members managers',
			description: 'Give members of a chat the bot owns the manager role. People who are not members are skipped without an error.',
			properties: [botIdProperty, dialogIdProperty('The group chat'), userIdsProperty],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const userIds = readUserIds(this, itemIndex);
				const body = await botRequest.call(this, 'imbot.v2.Chat.Manager.add', { botId: readBotId(this, itemIndex), dialogId, userIds }, itemIndex);
				return { dialogId, userIds, success: succeeded(body) };
			},
		},
		{
			value: 'removeManagers',
			name: 'Remove Managers',
			action: 'Take the manager role from chat members',
			description: 'Take the manager role from members of a chat the bot owns',
			properties: [botIdProperty, dialogIdProperty('The group chat'), userIdsProperty],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const userIds = readUserIds(this, itemIndex);
				const body = await botRequest.call(this, 'imbot.v2.Chat.Manager.delete', { botId: readBotId(this, itemIndex), dialogId, userIds }, itemIndex);
				return { dialogId, userIds, success: succeeded(body) };
			},
		},
		{
			value: 'showActivity',
			name: 'Show Activity Indicator',
			action: 'Show that the bot is working on a reply',
			description: 'Show "typing…" or an agent status such as "Agent is searching for information…" in the chat header while a workflow prepares the answer',
			properties: [
				botIdProperty,
				dialogIdProperty(),
				{ displayName: 'Status', name: 'status', type: 'options', default: 'typing', options: STATUS_OPTIONS },
				{ displayName: 'Duration (Seconds)', name: 'duration', type: 'number', typeOptions: { minValue: 0, maxValue: 600 }, default: 0, description: 'How long to show it, 1 to 600. 0 lets Bitrix24 decide.' },
			],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const params: IDataObject = { botId: readBotId(this, itemIndex), dialogId };
				const status = this.getNodeParameter('status', itemIndex, 'typing') as string;
				if (status !== 'typing') params.statusMessageCode = status;
				const duration = optionalInt(this.getNodeParameter('duration', itemIndex, 0));
				if (duration !== undefined) params.duration = Math.min(duration, 600);
				const body = await botRequest.call(this, 'imbot.v2.Chat.InputAction.notify', params, itemIndex);
				return { dialogId, status, shown: succeeded(body) };
			},
		},
		{
			value: 'setInputField',
			name: 'Set Input Field',
			action: 'Turn the chat input field on or off',
			description: 'Turn off typing in a chat with the bot, so people answer with keyboard buttons only, or turn it back on',
			properties: [
				botIdProperty,
				dialogIdProperty(),
				{ displayName: 'Allow Typing', name: 'enabled', type: 'boolean', default: false, description: 'Whether people can type in the chat. Off leaves only the buttons of the bot\'s messages.' },
			],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const enabled = this.getNodeParameter('enabled', itemIndex, false) === true;
				const body = await botRequest.call(this, 'imbot.v2.Chat.TextField.enabled', { botId: readBotId(this, itemIndex), dialogId, enabled }, itemIndex);
				return { dialogId, typingAllowed: enabled, success: succeeded(body) };
			},
		},
	],
};

export const chatMemberResource: Resource = {
	value: 'chatMember',
	name: 'Chat Member',
	description: 'People in a chat the bot administers',
	operations: [
		{
			value: 'add',
			name: 'Add',
			action: 'Add people to a chat of the bot',
			description: 'Add people to a group chat the bot administers. Missing or inactive users are skipped without an error.',
			properties: [botIdProperty, dialogIdProperty('The group chat'), userIdsProperty],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const userIds = readUserIds(this, itemIndex);
				const body = await botRequest.call(this, 'imbot.v2.Chat.User.add', { botId: readBotId(this, itemIndex), dialogId, userIds }, itemIndex);
				return { dialogId, userIds, success: succeeded(body) };
			},
		},
		{
			value: 'remove',
			name: 'Remove',
			action: 'Remove a person from a chat of the bot',
			description: 'Remove a person from a group chat the bot administers. Removing someone who is not there succeeds too.',
			properties: [botIdProperty, dialogIdProperty('The group chat'), { displayName: 'User ID', name: 'userId', type: 'number', required: true, default: 0 }],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const userId = readPositive(this, 'userId', itemIndex, 'User ID');
				const body = await botRequest.call(this, 'imbot.v2.Chat.User.delete', { botId: readBotId(this, itemIndex), dialogId, userId }, itemIndex);
				return { dialogId, userId, removed: succeeded(body) };
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the members of a chat of the bot',
			description: 'List up to 200 members of a chat the bot is in, with their profiles',
			properties: [
				botIdProperty,
				dialogIdProperty('The group chat'),
				{ displayName: 'Limit', name: 'limit', type: 'number', typeOptions: { minValue: 1, maxValue: 200 }, default: 50, description: 'Max number of results to return' },
				{
					displayName: 'Sort By',
					name: 'sort',
					type: 'options',
					default: 'id:ASC',
					options: [
						{ name: 'Joined First', value: 'id:ASC' },
						{ name: 'Joined Last', value: 'id:DESC' },
						{ name: 'Last Message, Newest', value: 'lastSendMessageId:DESC' },
						{ name: 'User ID', value: 'userId:ASC' },
					],
					description: 'Bitrix24 returns one page of at most 200 members; there is no paging',
				},
			],
			async execute(itemIndex) {
				const limit = Math.min(Math.max(Number(this.getNodeParameter('limit', itemIndex, 50)) || 50, 1), 200);
				const [field, direction] = String(this.getNodeParameter('sort', itemIndex, 'id:ASC')).split(':');
				const params = { botId: readBotId(this, itemIndex), dialogId: readDialogId(this, itemIndex), limit, order: { [field]: direction } };
				const body = await botRequest.call(this, 'imbot.v2.Chat.User.list', params, itemIndex);
				return Array.isArray(body.result) ? (body.result as IDataObject[]) : [];
			},
		},
	],
};
