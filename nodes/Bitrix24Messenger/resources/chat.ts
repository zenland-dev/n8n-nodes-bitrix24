import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../../shared/params';
import { numberProperty, positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList, yn } from '../../../shared/values';
import {
	binaryAsBase64,
	chatIdProperty,
	COLOR_OPTIONS,
	dialogIdProperty,
	offsetList,
	readChatId,
	readDialogId,
} from '../shared/helpers';

const userIdsProperty: INodeProperties = {
	displayName: 'User IDs',
	name: 'userIds',
	type: 'string',
	required: true,
	default: '',
	placeholder: '12, 34',
	description: 'Comma-separated user IDs',
};

const LINK_TYPES = [
	{ name: 'Announcement Chat', value: 'ANNOUNCEMENT' },
	{ name: 'Calendar Event', value: 'CALENDAR' },
	{ name: 'Call', value: 'CALL' },
	{ name: 'CRM Record', value: 'CRM' },
	{ name: 'Email Thread', value: 'MAIL' },
	{ name: 'Open Channel (Client Side)', value: 'LIVECHAT' },
	{ name: 'Open Channel (Operator Side)', value: 'LINES' },
	{ name: 'Private AI Assistant Chat', value: 'AI_ASSISTANT_PRIVATE' },
	{ name: 'Task (New Task Card)', value: 'TASKS_TASK' },
	{ name: 'Task (Old Task Card)', value: 'TASKS' },
	{ name: 'Video Conference', value: 'VIDEOCONF' },
	{ name: 'Workgroup', value: 'SONET_GROUP' },
];

const LINK_ID_DESCRIPTION =
	'CRM: DEAL|1663, LEAD|13, CONTACT|25, COMPANY|7 or DYNAMIC_1234|5 for a smart process item. Task and workgroup: the ID. Open channel: connector|line|chat|user, e.g. telegrambot|2|209607941|744.';

async function avatarOf(ctx: IExecuteFunctions, itemIndex: number, property: string): Promise<string> {
	const { content } = await binaryAsBase64(ctx, itemIndex, property);
	return content;
}

export const chatResource: Resource = {
	value: 'chat',
	name: 'Chat',
	description: 'Group chats: create, find, rename, recolor, mute and leave',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a group chat',
			description: 'Create a group chat with the given members; the webhook user becomes its owner',
			properties: [
				{ displayName: 'Title', name: 'title', type: 'string', default: '', description: 'Leave empty for a generated title such as "Chat with Alex, Sam"' },
				{ ...userIdsProperty, required: false, description: 'Comma-separated IDs of the members besides the webhook user' },
				{
					displayName: 'Additional Fields',
					name: 'additionalFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Color', name: 'color', type: 'options', default: 'MINT', options: COLOR_OPTIONS },
						{ displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 3 }, default: '' },
						{ displayName: 'First Message', name: 'message', type: 'string', typeOptions: { rows: 3 }, default: '', description: 'Posted into the chat as it is created' },
						{ displayName: 'Image Binary Property', name: 'avatarProperty', type: 'string', default: 'data', description: 'Input binary property holding the avatar image, up to 5000×5000' },
						{ displayName: 'Linked Object ID', name: 'entityId', type: 'string', default: '', description: LINK_ID_DESCRIPTION },
						{ displayName: 'Linked Object Type', name: 'entityType', type: 'string', default: '', placeholder: 'CRM', description: 'Binds the chat to an object so Find by Linked Object can reach it: CRM, CALENDAR, MAIL, TASKS, or a code of your own integration' },
						{
							displayName: 'Open to Everyone',
							name: 'open',
							type: 'boolean',
							default: false,
							description: 'Whether any employee may find and join the chat (an open chat) rather than only invited members',
						},
					],
				},
			],
			async execute(itemIndex) {
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const params: IDataObject = {};
				const users = idList(this, this.getNodeParameter('userIds', itemIndex, ''), 'User IDs', itemIndex);
				if (users.length > 0) params.USERS = users;
				const title = String(this.getNodeParameter('title', itemIndex, '') ?? '').trim();
				if (title !== '') params.TITLE = title;
				if (o.open !== undefined) params.TYPE = o.open === true ? 'OPEN' : 'CHAT';
				if (o.description) params.DESCRIPTION = o.description as string;
				if (o.color) params.COLOR = o.color as string;
				if (o.message) params.MESSAGE = o.message as string;
				const entityType = String(o.entityType ?? '').trim().toUpperCase();
				if (entityType === 'SONET_GROUP') {
					// A second chat bound to a workgroup breaks the chats of that group's tasks
					// (documented for im.chat.add); the group already has its own chat.
					throw new NodeOperationError(this.getNode(), 'A chat cannot be linked to a workgroup here', {
						itemIndex,
						description: 'Every workgroup already has its chat, sg<group ID>. A second one bound to the group breaks the chats of its tasks.',
					});
				}
				if (entityType !== '') {
					params.ENTITY_TYPE = entityType;
					params.ENTITY_ID = String(o.entityId ?? '');
				}
				if (o.avatarProperty) params.AVATAR = await avatarOf(this, itemIndex, o.avatarProperty as string);
				const body = await bitrix24Request.call(this, 'im.chat.add', params, { itemIndex });
				const chatId = Number(body.result);
				return { chatId, dialogId: `chat${chatId}` };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a chat',
			description: 'Retrieve a chat or private dialog: title, type, owner, members count, last message, permissions',
			properties: [dialogIdProperty()],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'im.dialog.get', { DIALOG_ID: readDialogId(this, itemIndex) }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'findByLinkedObject',
			name: 'Find by Linked Object',
			action: 'Find the chat of an object',
			description: 'Find the chat bound to a CRM record, task, workgroup, calendar event or open channel dialog',
			properties: [
				{ displayName: 'Linked Object Type', name: 'entityType', type: 'options', default: 'CRM', options: LINK_TYPES },
				{ displayName: 'Linked Object ID', name: 'entityId', type: 'string', required: true, default: '', placeholder: 'DEAL|1663', description: LINK_ID_DESCRIPTION },
			],
			async execute(itemIndex) {
				const params = { ENTITY_TYPE: this.getNodeParameter('entityType', itemIndex) as string, ENTITY_ID: String(this.getNodeParameter('entityId', itemIndex)).trim() };
				const body = await bitrix24Request.call(this, 'im.chat.get', params, { itemIndex });
				const id = Number((body.result as IDataObject | null)?.ID);
				return id > 0 ? { found: true, chatId: id, dialogId: `chat${id}` } : { found: false, chatId: null, dialogId: null };
			},
		},
		{
			value: 'search',
			name: 'Search',
			action: 'Search chats',
			description: 'Find chats the webhook user can see by title or by the names of their members',
			properties: [
				{ displayName: 'Search Text', name: 'find', type: 'string', required: true, default: '', description: 'At least 2 characters' },
				{ displayName: 'Open Channel Chats', name: 'inOpenLines', type: 'boolean', default: false, description: 'Whether to search open channel dialogs instead of ordinary chats' },
				...returnAllProperties('chats'),
			],
			async execute(itemIndex) {
				const find = String(this.getNodeParameter('find', itemIndex)).trim();
				if (find.length < 2) throw new NodeOperationError(this.getNode(), 'Search Text needs at least 2 characters', { itemIndex });
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const key = this.getNodeParameter('inOpenLines', itemIndex, false) === true ? 'FIND_LINES' : 'FIND';
				return await offsetList.call(this, 'im.search.chat.list', { [key]: find }, {
					pageSize: 50,
					limit: returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number),
					itemIndex,
				});
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a chat',
			description: 'Rename a group chat, change its color or avatar',
			properties: [
				chatIdProperty(),
				{
					displayName: 'Update Fields',
					name: 'updateFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Color', name: 'color', type: 'options', default: 'MINT', options: COLOR_OPTIONS, description: 'Shown in the mobile app and wherever the chat has no avatar' },
						{ displayName: 'Image Binary Property', name: 'avatarProperty', type: 'string', default: 'data', description: 'Input binary property holding the new avatar image' },
						{ displayName: 'Title', name: 'title', type: 'string', default: '' },
					],
				},
			],
			async execute(itemIndex) {
				const chatId = readChatId(this, itemIndex);
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const changed: string[] = [];
				if (typeof o.title === 'string' && o.title.trim() !== '') {
					await bitrix24Request.call(this, 'im.chat.updateTitle', { CHAT_ID: chatId, TITLE: o.title.trim() }, { itemIndex });
					changed.push('title');
				}
				if (o.color) {
					await bitrix24Request.call(this, 'im.chat.updateColor', { CHAT_ID: chatId, COLOR: o.color as string }, { itemIndex });
					changed.push('color');
				}
				if (o.avatarProperty) {
					await bitrix24Request.call(this, 'im.chat.updateAvatar', { CHAT_ID: chatId, AVATAR: await avatarOf(this, itemIndex, o.avatarProperty as string) }, { itemIndex });
					changed.push('avatar');
				}
				if (changed.length === 0) throw new NodeOperationError(this.getNode(), 'Nothing to update: add a title, color or avatar', { itemIndex });
				return { chatId, updated: changed };
			},
		},
		{
			value: 'setOwner',
			name: 'Set Owner',
			action: 'Change the owner of a chat',
			description: 'Make another member the owner of a group chat',
			properties: [chatIdProperty(), numberProperty('User ID', 'userId', 'The new owner, who must be a member of the chat')],
			async execute(itemIndex) {
				const params = { CHAT_ID: readChatId(this, itemIndex), USER_ID: positiveInt(this, 'userId', itemIndex, 'User ID') };
				await bitrix24Request.call(this, 'im.chat.setOwner', params, { itemIndex });
				return { chatId: params.CHAT_ID, ownerId: params.USER_ID };
			},
		},
		{
			value: 'mute',
			name: 'Mute or Unmute',
			action: 'Mute or unmute a chat',
			description: 'Turn notifications from a chat off or back on for the webhook user',
			properties: [dialogIdProperty(), { displayName: 'Mute', name: 'mute', type: 'boolean', default: true, description: 'Whether to turn notifications off (on) or back on (off)' }],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const mute = this.getNodeParameter('mute', itemIndex) === true;
				await bitrix24Request.call(this, 'im.chat.mute', { DIALOG_ID: dialogId, MUTE: yn(mute) }, { itemIndex });
				return { dialogId, muted: mute };
			},
		},
		{
			value: 'leave',
			name: 'Leave',
			action: 'Leave a chat',
			description: 'Take the webhook user out of a group chat',
			properties: [chatIdProperty()],
			async execute(itemIndex) {
				const chatId = readChatId(this, itemIndex);
				await bitrix24Request.call(this, 'im.chat.leave', { CHAT_ID: chatId }, { itemIndex });
				return { chatId, left: true };
			},
		},
	],
};

export const chatMemberResource: Resource = {
	value: 'chatMember',
	name: 'Chat Member',
	description: 'Who is in a chat',
	operations: [
		{
			value: 'add',
			name: 'Add',
			action: 'Add members to a chat',
			description: 'Add users to a group chat',
			properties: [
				chatIdProperty(),
				userIdsProperty,
				{ displayName: 'Show Earlier Messages', name: 'showHistory', type: 'boolean', default: false, description: 'Whether the new members see the messages sent before they joined' },
			],
			async execute(itemIndex) {
				const chatId = readChatId(this, itemIndex);
				const users = idList(this, this.getNodeParameter('userIds', itemIndex), 'User IDs', itemIndex);
				if (users.length === 0) throw new NodeOperationError(this.getNode(), 'User IDs: give at least one user', { itemIndex });
				const showHistory = this.getNodeParameter('showHistory', itemIndex, false) === true;
				await bitrix24Request.call(this, 'im.chat.user.add', { CHAT_ID: chatId, USERS: users, HIDE_HISTORY: yn(!showHistory) }, { itemIndex });
				return users.map((userId) => ({ chatId, userId, added: true }));
			},
		},
		{
			value: 'remove',
			name: 'Remove',
			action: 'Remove a member from a chat',
			description: 'Take a user out of a group chat',
			properties: [chatIdProperty(), numberProperty('User ID', 'userId', 'The member to remove')],
			async execute(itemIndex) {
				const params = { CHAT_ID: readChatId(this, itemIndex), USER_ID: positiveInt(this, 'userId', itemIndex, 'User ID') };
				await bitrix24Request.call(this, 'im.chat.user.delete', params, { itemIndex });
				return { chatId: params.CHAT_ID, userId: params.USER_ID, removed: true };
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the members of a chat',
			description: 'List the members of a chat or dialog with their names, positions and activity',
			properties: [
				dialogIdProperty(),
				...returnAllProperties('members'),
				{ displayName: 'Skip System Users', name: 'skipExternal', type: 'boolean', default: false, description: 'Whether to leave out bots, connectors and other system users' },
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const params: IDataObject = { DIALOG_ID: readDialogId(this, itemIndex) };
				if (this.getNodeParameter('skipExternal', itemIndex, false) === true) params.SKIP_EXTERNAL = 'Y';
				return await offsetList.call(this, 'im.dialog.users.list', params, {
					pageSize: 200,
					limit: returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number),
					itemIndex,
				});
			},
		},
		{
			value: 'getIds',
			name: 'Get IDs',
			action: 'Get the member IDs of a chat',
			description: 'List only the user IDs of a group chat, in one request. Bitrix24 refuses it on the company-wide general chat, where Get Many works.',
			properties: [chatIdProperty()],
			async execute(itemIndex) {
				const chatId = readChatId(this, itemIndex);
				const body = await bitrix24Request.call(this, 'im.chat.user.list', { CHAT_ID: chatId }, { itemIndex });
				return (Array.isArray(body.result) ? body.result : []).map((id) => ({ chatId, userId: Number(id) }));
			},
		},
	],
};

function flag(displayName: string, name: string): INodeProperties {
	return { displayName, name, type: 'boolean', default: true };
}

const SKIP_FLAGS: INodeProperties[] = [flag('Skip Group Chats', 'skipChat'), flag('Skip Open Channels', 'skipOpenLines'), flag('Skip Private Dialogs', 'skipDialog')];

function filtersProperty(extra: INodeProperties[]): INodeProperties {
	const options = [...SKIP_FLAGS, ...extra].sort((a, b) => a.displayName.localeCompare(b.displayName));
	return { displayName: 'Filters', name: 'filters', type: 'collection', placeholder: 'Add Filter', default: {}, options };
}

function recentFlags(f: IDataObject): IDataObject {
	const params: IDataObject = {};
	if (f.skipChat !== undefined) params.SKIP_CHAT = yn(f.skipChat);
	if (f.skipDialog !== undefined) params.SKIP_DIALOG = yn(f.skipDialog);
	if (f.skipOpenLines !== undefined) params.SKIP_OPENLINES = yn(f.skipOpenLines);
	return params;
}

export const recentResource: Resource = {
	value: 'recent',
	name: 'Recent Chat',
	description: 'The list of recent conversations of the webhook user',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get recent conversations',
			description: 'List the conversations of the webhook user, newest activity first, with the last message and unread counter',
			properties: [
				...returnAllProperties('conversations'),
				filtersProperty([
					flag('Only Channels', 'onlyChannel'),
					flag('Only BitrixGPT Chats', 'onlyCopilot'),
					flag('Only Open Channels', 'onlyOpenLines'),
					flag('Only Unread', 'unreadOnly'),
					flag('Skip Undistributed Open Channels', 'skipUndistributed'),
				]),
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const params = recentFlags(f);
				if (f.onlyOpenLines !== undefined) params.ONLY_OPENLINES = yn(f.onlyOpenLines);
				if (f.unreadOnly !== undefined) params.UNREAD_ONLY = yn(f.unreadOnly);
				if (f.onlyChannel !== undefined) params.ONLY_CHANNEL = yn(f.onlyChannel);
				if (f.onlyCopilot !== undefined) params.ONLY_COPILOT = yn(f.onlyCopilot);
				if (f.skipUndistributed !== undefined) params.SKIP_UNDISTRIBUTED_OPENLINES = yn(f.skipUndistributed);
				const found = await offsetList.call(this, 'im.recent.list', params, {
					pageSize: 200,
					itemsKey: 'items',
					limit: returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number),
					itemIndex,
				});
				// Pages overlap: Bitrix24 builds them from internal records and collapses those into dialogs.
				const seen = new Set<string>();
				return found.filter((row) => {
					const key = String(row.id);
					if (seen.has(key)) return false;
					seen.add(key);
					return true;
				});
			},
		},
		{
			value: 'getChanges',
			name: 'Get Changes',
			action: 'Get recently changed conversations',
			description: 'List the conversations that changed since a moment, up to 7 days back',
			properties: [
				{ displayName: 'Changed Since', name: 'since', type: 'dateTime', required: true, default: '', description: 'Bitrix24 returns changes of the last 7 days at most' },
				filtersProperty([flag('Only Open Channels', 'onlyOpenLines')]),
			],
			async execute(itemIndex) {
				const since = String(this.getNodeParameter('since', itemIndex) ?? '');
				if (since === '') throw new NodeOperationError(this.getNode(), 'Changed Since is required', { itemIndex });
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const params: IDataObject = { ...recentFlags(f), LAST_SYNC_DATE: since };
				if (f.onlyOpenLines !== undefined) params.ONLY_OPENLINES = yn(f.onlyOpenLines);
				const body = await bitrix24Request.call(this, 'im.recent.get', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'pin',
			name: 'Pin or Unpin',
			action: 'Pin or unpin a conversation',
			description: 'Pin a conversation to the top of the recent list of the webhook user, or unpin it',
			properties: [dialogIdProperty(), { displayName: 'Pin', name: 'pin', type: 'boolean', default: true, description: 'Whether to pin (on) or unpin (off)' }],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const pin = this.getNodeParameter('pin', itemIndex) === true;
				await bitrix24Request.call(this, 'im.recent.pin', { DIALOG_ID: dialogId, PIN: yn(pin) }, { itemIndex });
				return { dialogId, pinned: pin };
			},
		},
		{
			value: 'hide',
			name: 'Hide',
			action: 'Hide a conversation from the recent list',
			description: 'Remove a conversation from the recent list of the webhook user; it comes back with the next message',
			properties: [dialogIdProperty()],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				await bitrix24Request.call(this, 'im.recent.hide', { DIALOG_ID: dialogId }, { itemIndex });
				return { dialogId, hidden: true };
			},
		},
		{
			value: 'setUnreadMark',
			name: 'Set Unread Mark',
			action: 'Mark a conversation as unread or read',
			description: 'Put the manual "unread" mark on a conversation, or take it off and mark the conversation read',
			properties: [dialogIdProperty(), { displayName: 'Unread', name: 'unread', type: 'boolean', default: true, description: 'Whether to set the mark (on) or remove it and read the conversation (off)' }],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const unread = this.getNodeParameter('unread', itemIndex) === true;
				const body = await bitrix24Request.call(this, 'im.recent.unread', { DIALOG_ID: dialogId, ACTION: yn(unread) }, { itemIndex });
				if (body.result === false) throw new NodeOperationError(this.getNode(), `Conversation ${dialogId} was not found`, { itemIndex });
				return { dialogId, unread };
			},
		},
	],
};
