import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { numberProperty } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { downloadExecutor, outputBinaryProperty, readId, withoutLink } from '../shared/helpers';

const attachmentIdProperty = numberProperty(
	'Attachment ID',
	'attachmentId',
	'ID of the attachment record that links a Drive file to a task, comment or list item. A task lists them in ufTaskWebdavFiles; drop the n in front.',
);

async function readAttachment(ctx: IExecuteFunctions, itemIndex: number): Promise<{ id: number; meta: IDataObject }> {
	const id = readId(ctx, 'attachmentId', itemIndex, 'Attachment ID');
	const body = await bitrix24Request.call(ctx, 'disk.attachedObject.get', { id }, { itemIndex });
	return { id, meta: (body.result ?? {}) as IDataObject };
}

export const attachedFileResource: Resource = {
	value: 'attachedFile',
	name: 'Attached File',
	description: 'Drive files attached to tasks, comments, feed posts and list items',
	operations: [
		{
			value: 'get',
			name: 'Get',
			action: 'Get an attached file',
			description: 'Retrieve an attachment by ID: the Drive file ID (OBJECT_ID), the module and the record it is attached to',
			properties: [attachmentIdProperty],
			async execute(itemIndex) {
				return withoutLink((await readAttachment(this, itemIndex)).meta);
			},
		},
		{
			value: 'download',
			name: 'Download',
			action: 'Download an attached file',
			description: 'Download an attached file into binary data',
			properties: [attachmentIdProperty, outputBinaryProperty],
			executeAll: downloadExecutor(readAttachment),
		},
	],
};
