import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import { jsonParameter, returnAllProperties } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { entityTypeName } from '../shared/entityTypes';
import { entityTypeProperty, jsonProperty, numberProperty, positiveInt, rows } from '../shared/props';

const record: INodeProperties[] = [
	entityTypeProperty('Type of the CRM record whose timeline this is'),
	numberProperty('Record ID', 'entityId', 'ID of the lead, deal, contact or other record'),
];

function recordParams(ctx: IExecuteFunctions, itemIndex: number): { typeId: number; id: number; typeName: string } {
	const typeId = positiveInt(ctx, 'entityTypeId', itemIndex, 'Entity type');
	return { typeId, id: positiveInt(ctx, 'entityId', itemIndex, 'Record ID'), typeName: entityTypeName(typeId).toLowerCase() };
}

const filesProperty = jsonProperty(
	'Files (JSON)',
	'files',
	'Files to attach as [["name.pdf", "&lt;base64 content&gt;"], …], or Drive file IDs as ["n123", …]. Leave [] for none.',
	'[]',
);

export const timelineCommentResource: Resource = {
	value: 'timelineComment',
	name: 'Timeline Comment',
	description: 'Comments in the timeline of a CRM record',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Add a comment to a timeline',
			description: 'Post a comment into the timeline of a lead, deal, contact or other record; BB codes are allowed',
			properties: [
				...record,
				{ displayName: 'Comment', name: 'comment', type: 'string', typeOptions: { rows: 4 }, required: true, default: '' },
				filesProperty,
			],
			async execute(itemIndex) {
				const { id, typeName } = recordParams(this, itemIndex);
				const fields: IDataObject = {
					ENTITY_ID: id,
					ENTITY_TYPE: typeName,
					COMMENT: this.getNodeParameter('comment', itemIndex) as string,
				};
				const files = jsonParameter<unknown[]>(this, 'files', itemIndex, []);
				if (Array.isArray(files) && files.length > 0) fields.FILES = files as IDataObject[];
				const body = await bitrix24Request.call(this, 'crm.timeline.comment.add', { fields }, { itemIndex });
				return { id: body.result as number };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a timeline comment',
			description: 'Retrieve one comment with its text, author and files',
			properties: [numberProperty('Comment ID', 'commentId', 'ID of the comment')],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.timeline.comment.get', { id: positiveInt(this, 'commentId', itemIndex, 'Comment ID') }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the comments of a record',
			description: 'List the timeline comments of one record, newest first',
			properties: [...record, ...returnAllProperties('comments')],
			async execute(itemIndex) {
				const { id, typeName } = recordParams(this, itemIndex);
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				return await listAll.call(
					this,
					'crm.timeline.comment.list',
					{ filter: { ENTITY_ID: id, ENTITY_TYPE: typeName }, order: { CREATED: 'DESC' } },
					{ limit, itemIndex },
				);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a timeline comment',
			description: 'Replace the text of a comment',
			properties: [
				numberProperty('Comment ID', 'commentId', 'ID of the comment'),
				...record,
				{ displayName: 'Comment', name: 'comment', type: 'string', typeOptions: { rows: 4 }, required: true, default: '' },
			],
			async execute(itemIndex) {
				const { typeId, id } = recordParams(this, itemIndex);
				const body = await bitrix24Request.call(
					this,
					'crm.timeline.comment.update',
					{
						id: positiveInt(this, 'commentId', itemIndex, 'Comment ID'),
						ownerTypeId: typeId,
						ownerId: id,
						fields: { COMMENT: this.getNodeParameter('comment', itemIndex) as string },
					},
					{ itemIndex },
				);
				return { id: body.result as number };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a timeline comment',
			description: 'Remove a comment from the timeline',
			properties: [numberProperty('Comment ID', 'commentId', 'ID of the comment'), ...record],
			async execute(itemIndex) {
				const { typeId, id } = recordParams(this, itemIndex);
				const commentId = positiveInt(this, 'commentId', itemIndex, 'Comment ID');
				await bitrix24Request.call(this, 'crm.timeline.comment.delete', { id: commentId, ownerTypeId: typeId, ownerId: id }, { itemIndex });
				return { id: commentId, deleted: true };
			},
		},
	],
};

const noteTarget: INodeProperties[] = [
	...record,
	{
		displayName: 'Note On',
		name: 'itemType',
		type: 'options',
		default: 2,
		options: [
			{ name: 'Activity', value: 2 },
			{ name: 'History Entry', value: 1 },
		],
		description: 'What the note is attached to',
	},
	numberProperty('Activity or Entry ID', 'itemId', 'ID of the activity or of the timeline history entry'),
];

function noteParams(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const { typeId, id } = recordParams(ctx, itemIndex);
	return {
		ownerTypeId: typeId,
		ownerId: id,
		itemType: Number(ctx.getNodeParameter('itemType', itemIndex)),
		itemId: positiveInt(ctx, 'itemId', itemIndex, 'Activity or Entry ID'),
	};
}

export const timelineNoteResource: Resource = {
	value: 'timelineNote',
	name: 'Timeline Note',
	description: 'The note pinned under an activity or history entry',
	operations: [
		{
			value: 'save',
			name: 'Save',
			action: 'Save a note on an activity',
			description: 'Write the note of an activity or history entry, replacing any note it had',
			properties: [...noteTarget, { displayName: 'Text', name: 'text', type: 'string', typeOptions: { rows: 3 }, required: true, default: '' }],
			async execute(itemIndex) {
				await bitrix24Request.call(this, 'crm.timeline.note.save', { ...noteParams(this, itemIndex), text: this.getNodeParameter('text', itemIndex) as string }, { itemIndex });
				return { saved: true };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get the note of an activity',
			description: 'Read the note of an activity or history entry',
			properties: noteTarget,
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.timeline.note.get', noteParams(this, itemIndex), { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete the note of an activity',
			description: 'Remove the note of an activity or history entry',
			properties: noteTarget,
			async execute(itemIndex) {
				await bitrix24Request.call(this, 'crm.timeline.note.delete', noteParams(this, itemIndex), { itemIndex });
				return { deleted: true };
			},
		},
	],
};

export const timelineLogMessageResource: Resource = {
	value: 'timelineLogMessage',
	name: 'Timeline Log Entry',
	description: 'System-style entries an integration writes into a timeline',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Add a log entry to a timeline',
			description: 'Write an informational entry with a title, text and icon, e.g. "Order paid on the website"',
			properties: [
				...record,
				{ displayName: 'Title', name: 'title', type: 'string', required: true, default: '' },
				{ displayName: 'Text', name: 'text', type: 'string', typeOptions: { rows: 3 }, required: true, default: '' },
				{
					displayName: 'Icon Code',
					name: 'iconCode',
					type: 'string',
					required: true,
					default: 'info',
					description: 'Icon of the entry, e.g. info, attention, check, call — or the code of an icon the application added',
				},
			],
			async execute(itemIndex) {
				const { typeId, id } = recordParams(this, itemIndex);
				const fields = {
					entityTypeId: typeId,
					entityId: id,
					title: this.getNodeParameter('title', itemIndex) as string,
					text: this.getNodeParameter('text', itemIndex) as string,
					iconCode: this.getNodeParameter('iconCode', itemIndex) as string,
				};
				const body = await bitrix24Request.call(this, 'crm.timeline.logmessage.add', { fields }, { itemIndex });
				return rows(body.result, 'logMessage');
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a timeline log entry',
			description: 'Retrieve one log entry',
			properties: [numberProperty('Entry ID', 'entryId', 'ID of the log entry')],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.timeline.logmessage.get', { id: positiveInt(this, 'entryId', itemIndex, 'Entry ID') }, { itemIndex });
				return rows(body.result, 'logMessage');
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the log entries of a record',
			description: 'List the log entries written into one record',
			properties: [...record, ...returnAllProperties('entries')],
			async execute(itemIndex) {
				const { typeId, id } = recordParams(this, itemIndex);
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				return await listAll.call(this, 'crm.timeline.logmessage.list', { entityTypeId: typeId, entityId: id }, { itemsKey: 'logMessages', limit, itemIndex });
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a timeline log entry',
			description: 'Remove a log entry. Bitrix24 allows it only to the application that wrote the entry, so entries written through a webhook stay.',
			properties: [numberProperty('Entry ID', 'entryId', 'ID of the log entry')],
			async execute(itemIndex) {
				const id = positiveInt(this, 'entryId', itemIndex, 'Entry ID');
				await bitrix24Request.call(this, 'crm.timeline.logmessage.delete', { id }, { itemIndex });
				return { id, deleted: true };
			},
		},
	],
};

const entryId = numberProperty('Timeline Entry ID', 'timelineId', 'ID of the timeline entry (a comment, log entry or activity record)');

export const timelineEntryResource: Resource = {
	value: 'timelineEntry',
	name: 'Timeline Entry',
	description: 'Which records a timeline entry shows in, and pinning it',
	operations: [
		{
			value: 'bind',
			name: 'Link to Record',
			action: 'Show a timeline entry in another record',
			description: 'Make an existing timeline entry also appear in the timeline of another record',
			properties: [entryId, ...record],
			async execute(itemIndex) {
				const { id, typeName } = recordParams(this, itemIndex);
				const fields = { OWNER_ID: positiveInt(this, 'timelineId', itemIndex, 'Timeline Entry ID'), ENTITY_ID: id, ENTITY_TYPE: typeName };
				await bitrix24Request.call(this, 'crm.timeline.bindings.bind', { fields }, { itemIndex });
				return { linked: true, ...fields };
			},
		},
		{
			value: 'unbind',
			name: 'Unlink From Record',
			action: 'Remove a timeline entry from a record',
			description: 'Stop a timeline entry appearing in one of the records it is linked to',
			properties: [entryId, ...record],
			async execute(itemIndex) {
				const { id, typeName } = recordParams(this, itemIndex);
				const fields = { OWNER_ID: positiveInt(this, 'timelineId', itemIndex, 'Timeline Entry ID'), ENTITY_ID: id, ENTITY_TYPE: typeName };
				await bitrix24Request.call(this, 'crm.timeline.bindings.unbind', { fields }, { itemIndex });
				return { unlinked: true, ...fields };
			},
		},
		{
			value: 'getLinks',
			name: 'Get Links',
			action: 'Get the records a timeline entry is linked to',
			description: 'List every record whose timeline shows this entry',
			properties: [entryId],
			async execute(itemIndex) {
				return await listAll.call(this, 'crm.timeline.bindings.list', { filter: { OWNER_ID: positiveInt(this, 'timelineId', itemIndex, 'Timeline Entry ID') } }, { itemIndex });
			},
		},
		{
			value: 'pin',
			name: 'Pin',
			action: 'Pin a timeline entry',
			description: 'Pin an entry to the top of a record timeline',
			properties: [entryId, ...record],
			async execute(itemIndex) {
				const { typeId, id } = recordParams(this, itemIndex);
				await bitrix24Request.call(this, 'crm.timeline.item.pin', { id: positiveInt(this, 'timelineId', itemIndex, 'Timeline Entry ID'), ownerTypeId: typeId, ownerId: id }, { itemIndex });
				return { pinned: true };
			},
		},
		{
			value: 'unpin',
			name: 'Unpin',
			action: 'Unpin a timeline entry',
			description: 'Release a pinned entry back into the timeline flow',
			properties: [entryId, ...record],
			async execute(itemIndex) {
				const { typeId, id } = recordParams(this, itemIndex);
				await bitrix24Request.call(this, 'crm.timeline.item.unpin', { id: positiveInt(this, 'timelineId', itemIndex, 'Timeline Entry ID'), ownerTypeId: typeId, ownerId: id }, { itemIndex });
				return { pinned: false };
			},
		},
	],
};
