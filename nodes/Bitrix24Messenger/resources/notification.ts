import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../../shared/params';
import { numberProperty, positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList } from '../../../shared/values';
import { ATTACH_DESCRIPTION, optionalJson, valuesOf } from '../shared/helpers';

const notificationIdProperty = numberProperty('Notification ID', 'notificationId', 'ID of the notification, as Send returns it or Get Many lists it');

/** Largest page of im.notify.get and im.notify.history.search. */
const NOTIFY_PAGE = 50;
const MAX_PAGES = 20_000;

/** A confirmation notification (buttons) has type 1; the cursor needs the stage the last one came from. */
function lastType(row: IDataObject): number {
	return Number(row.notify_type) === 1 ? 1 : 3;
}

/** Puts each notification's author next to it instead of in a separate list. */
function withAuthors(notifications: IDataObject[], users: unknown): IDataObject[] {
	const byId = new Map(valuesOf(users).map((u) => [Number(u.id), u]));
	return notifications.map((n) => (byId.has(Number(n.author_id)) ? { ...n, author: byId.get(Number(n.author_id)) as IDataObject } : n));
}

export const notificationResource: Resource = {
	value: 'notification',
	name: 'Notification',
	description: 'Notifications in the bell of a user, and the notifications of the webhook user',
	operations: [
		{
			value: 'send',
			name: 'Send',
			action: 'Send a notification',
			description: 'Put a notification into the bell of a user, from the webhook user or as a system notification',
			properties: [
				numberProperty('User ID', 'userId', 'Who receives the notification'),
				{ displayName: 'Text', name: 'text', type: 'string', typeOptions: { rows: 3 }, required: true, default: '', description: 'Notification text with BB codes' },
				{
					displayName: 'Type',
					name: 'notifyType',
					type: 'options',
					default: 'personal',
					options: [
						{ name: 'From the Webhook User', value: 'personal', description: 'Shows the webhook user as the author' },
						{ name: 'System', value: 'system', description: 'Shows no author' },
					],
				},
				{
					displayName: 'Additional Fields',
					name: 'additionalFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Attachment (JSON)', name: 'attach', type: 'json', default: '{}', description: ATTACH_DESCRIPTION },
						{ displayName: 'Text for Email', name: 'textOut', type: 'string', typeOptions: { rows: 3 }, default: '', description: 'Text used when the notification goes out by email or push' },
					],
				},
			],
			async execute(itemIndex) {
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const text = String(this.getNodeParameter('text', itemIndex) ?? '');
				if (text.trim() === '') throw new NodeOperationError(this.getNode(), 'Text is required', { itemIndex });
				const params: IDataObject = { USER_ID: positiveInt(this, 'userId', itemIndex, 'User ID'), MESSAGE: text };
				if (o.textOut) params.MESSAGE_OUT = o.textOut as string;
				const attach = optionalJson(this, o.attach, 'Attachment (JSON)', itemIndex);
				if (attach !== undefined) params.ATTACH = attach;
				const method = this.getNodeParameter('notifyType', itemIndex) === 'system' ? 'im.notify.system.add' : 'im.notify.personal.add';
				const body = await bitrix24Request.call(this, method, params, { itemIndex });
				if (body.result === false) throw new NodeOperationError(this.getNode(), 'Bitrix24 did not create the notification', { itemIndex });
				return { notificationId: Number(body.result), userId: params.USER_ID };
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get notifications of the webhook user',
			description: 'List the notifications of the webhook user, newest first, confirmations with buttons ahead of the rest',
			properties: [...returnAllProperties('notifications'), { displayName: 'Convert Text', name: 'convertText', type: 'boolean', default: false, description: 'Whether to turn BB codes into HTML in the text' }],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? Infinity : (this.getNodeParameter('limit', itemIndex) as number);
				const base: IDataObject = { LIMIT: NOTIFY_PAGE };
				if (this.getNodeParameter('convertText', itemIndex, false) === true) base.CONVERT_TEXT = 'Y';
				const out: IDataObject[] = [];
				let cursor: IDataObject = {};
				for (let page = 0; page < MAX_PAGES && out.length < limit; page++) {
					const body = await bitrix24Request.call(this, 'im.notify.get', { ...base, ...cursor }, { itemIndex });
					const result = (body.result ?? {}) as IDataObject;
					const list = valuesOf(result.notifications);
					out.push(...withAuthors(list, result.users));
					if (list.length < NOTIFY_PAGE) break;
					const last = list[list.length - 1];
					const next = { LAST_ID: Number(last.id), LAST_TYPE: lastType(last) };
					if (next.LAST_ID === cursor.LAST_ID && next.LAST_TYPE === cursor.LAST_TYPE) break;
					cursor = next;
				}
				return out.slice(0, limit);
			},
		},
		{
			value: 'search',
			name: 'Search',
			action: 'Search notifications of the webhook user',
			description: 'Search the notification history of the webhook user by text, type, author and date',
			properties: [
				{ displayName: 'Search Text', name: 'text', type: 'string', default: '', description: 'At least 3 characters, unless a type or date filter is set' },
				...returnAllProperties('notifications'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{ displayName: 'Author IDs', name: 'authors', type: 'string', default: '', placeholder: '1, 7', description: 'Comma-separated user IDs' },
						{ displayName: 'Date From', name: 'dateFrom', type: 'dateTime', default: '', description: 'Used together with Date To' },
						{ displayName: 'Date To', name: 'dateTo', type: 'dateTime', default: '' },
						{ displayName: 'Group Tag', name: 'groupTag', type: 'string', default: '' },
						{ displayName: 'On Date', name: 'date', type: 'dateTime', default: '' },
						{ displayName: 'Types', name: 'types', type: 'string', default: '', placeholder: 'tasks, crm|changeAssignedBy', description: 'Comma-separated modules or module|event codes, as Get Types lists them' },
					],
				},
			],
			async execute(itemIndex) {
				const text = String(this.getNodeParameter('text', itemIndex, '') ?? '').trim();
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? Infinity : (this.getNodeParameter('limit', itemIndex) as number);
				const base: IDataObject = { LIMIT: NOTIFY_PAGE };
				if (text !== '') base.SEARCH_TEXT = text;
				const types = String(f.types ?? '').split(',').map((t) => t.trim()).filter((t) => t !== '');
				if (types.length > 0) base.SEARCH_TYPES = types;
				const authors = idList(this, f.authors, 'Author IDs', itemIndex);
				if (authors.length > 0) base.SEARCH_AUTHORS = authors;
				if (f.date) base.SEARCH_DATE = f.date as string;
				if (f.dateFrom || f.dateTo) {
					if (!f.dateFrom || !f.dateTo) throw new NodeOperationError(this.getNode(), 'Date From and Date To go together', { itemIndex });
					base.SEARCH_DATE_FROM = f.dateFrom as string;
					base.SEARCH_DATE_TO = f.dateTo as string;
				}
				if (f.groupTag) base.GROUP_TAG = f.groupTag as string;
				if (text.length < 3 && types.length === 0 && !f.date && !f.dateFrom) {
					throw new NodeOperationError(this.getNode(), 'Give a search text of 3 characters or more, or a type or date filter', { itemIndex });
				}
				const out: IDataObject[] = [];
				let lastId: number | undefined;
				for (let page = 0; page < MAX_PAGES && out.length < limit; page++) {
					const body = await bitrix24Request.call(this, 'im.notify.history.search', { ...base, ...(lastId === undefined ? {} : { LAST_ID: lastId }) }, { itemIndex });
					const result = (body.result ?? {}) as IDataObject;
					const list = valuesOf(result.notifications);
					out.push(...withAuthors(list, result.users));
					if (list.length < NOTIFY_PAGE) break;
					const nextId = Number(list[list.length - 1].id);
					if (!Number.isFinite(nextId) || nextId === lastId) break;
					lastId = nextId;
				}
				return out.slice(0, limit);
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a notification',
			description: 'Delete a notification by its ID',
			properties: [notificationIdProperty],
			async execute(itemIndex) {
				const id = positiveInt(this, 'notificationId', itemIndex, 'Notification ID');
				const body = await bitrix24Request.call(this, 'im.notify.delete', { ID: id }, { itemIndex });
				return { notificationId: id, deleted: body.result === true };
			},
		},
		{
			value: 'markRead',
			name: 'Mark as Read',
			action: 'Mark notifications as read or unread',
			description: 'Mark notifications of the webhook user as read or unread',
			properties: [
				{ displayName: 'Notification IDs', name: 'notificationIds', type: 'string', required: true, default: '', placeholder: '101, 102', description: 'Comma-separated notification IDs' },
				{
					displayName: 'Mark As',
					name: 'markAs',
					type: 'options',
					default: 'read',
					options: [
						{ name: 'Read', value: 'read' },
						{ name: 'Unread', value: 'unread' },
					],
				},
				{ displayName: 'Newer Ones Too', name: 'andNewer', type: 'boolean', default: false, description: 'Whether to mark every notification with an ID at or above the given one as well; takes exactly one ID' },
			],
			async execute(itemIndex) {
				const ids = idList(this, this.getNodeParameter('notificationIds', itemIndex), 'Notification IDs', itemIndex);
				if (ids.length === 0) throw new NodeOperationError(this.getNode(), 'Notification IDs: give at least one ID', { itemIndex });
				const action = this.getNodeParameter('markAs', itemIndex) === 'unread' ? 'N' : 'Y';
				if (this.getNodeParameter('andNewer', itemIndex, false) === true) {
					if (ids.length !== 1) throw new NodeOperationError(this.getNode(), 'Newer Ones Too takes exactly one notification ID', { itemIndex });
					await bitrix24Request.call(this, 'im.notify.read', { ID: ids[0], ACTION: action, ONLY_CURRENT: 'N' }, { itemIndex });
				} else {
					await bitrix24Request.call(this, 'im.notify.read.list', { IDS: ids, ACTION: action }, { itemIndex });
				}
				return ids.map((id) => ({ notificationId: id, read: action === 'Y' }));
			},
		},
		{
			value: 'markAllRead',
			name: 'Mark All as Read',
			action: 'Mark every notification as read',
			description: 'Mark every notification of the webhook user as read',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'im.notify.read.all', {}, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'answer',
			name: 'Answer',
			action: 'Reply to a notification',
			description: 'Send a quick text reply to a notification that offers one',
			properties: [notificationIdProperty, { displayName: 'Text', name: 'text', type: 'string', typeOptions: { rows: 3 }, required: true, default: '' }],
			async execute(itemIndex) {
				const params = { NOTIFY_ID: positiveInt(this, 'notificationId', itemIndex, 'Notification ID'), ANSWER_TEXT: String(this.getNodeParameter('text', itemIndex) ?? '') };
				if (params.ANSWER_TEXT.trim() === '') throw new NodeOperationError(this.getNode(), 'Text is required', { itemIndex });
				const body = await bitrix24Request.call(this, 'im.notify.answer', params, { itemIndex });
				return { notificationId: params.NOTIFY_ID, ...((body.result ?? {}) as IDataObject) };
			},
		},
		{
			value: 'confirm',
			name: 'Press Button',
			action: 'Press a button of a notification',
			description: 'Answer a notification with buttons, such as an invitation to accept or decline',
			properties: [notificationIdProperty, { displayName: 'Button Value', name: 'value', type: 'string', required: true, default: '', placeholder: 'Y', description: 'The value of the button, e.g. Y to accept and N to decline; Get Many shows them under notify_buttons' }],
			async execute(itemIndex) {
				const params = { NOTIFY_ID: positiveInt(this, 'notificationId', itemIndex, 'Notification ID'), NOTIFY_VALUE: String(this.getNodeParameter('value', itemIndex) ?? '').trim() };
				if (params.NOTIFY_VALUE === '') throw new NodeOperationError(this.getNode(), 'Button Value is required', { itemIndex });
				const body = await bitrix24Request.call(this, 'im.notify.confirm', params, { itemIndex });
				return { notificationId: params.NOTIFY_ID, value: params.NOTIFY_VALUE, ...((body.result ?? {}) as IDataObject) };
			},
		},
		{
			value: 'getTypes',
			name: 'Get Types',
			action: 'Get notification types',
			description: 'List the notification types of every module, the codes Search filters by',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'im.notify.schema.get', {}, { itemIndex });
				return Object.entries((body.result ?? {}) as IDataObject).map(([module, value]) => {
					const entry = (value ?? {}) as IDataObject;
					return { module: (entry.MODULE_ID as string) ?? module, name: entry.NAME ?? null, types: entry.LIST ?? [] };
				});
			},
		},
	],
};
