import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { downloadToBinary } from '../../../shared/download';
import { asNodeError } from '../../../shared/errors';
import { numberProperty, positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request, portalKey } from '../../../shared/transport';
import { idList } from '../../../shared/values';
import { binaryAsBase64, chatIdProperty, dialogIdProperty, readChatId, readDialogId } from '../shared/helpers';

const fileIdProperty = numberProperty('File ID', 'fileId', 'ID of the file on Drive, as Upload returns it or a message lists it under params.FILE_ID');

async function downloadLink(ctx: IExecuteFunctions, itemIndex: number): Promise<{ dialogId: string; fileId: number; url: string }> {
	const dialogId = readDialogId(ctx, itemIndex);
	const fileId = positiveInt(ctx, 'fileId', itemIndex, 'File ID');
	const body = await bitrix24Request.call(ctx, 'im.v2.File.download', { dialogId, fileId }, { itemIndex });
	const url = String((body.result as IDataObject | null)?.downloadUrl ?? '');
	if (url === '') throw new NodeOperationError(ctx.getNode(), `Bitrix24 gave no download link for file ${fileId}`, { itemIndex });
	return { dialogId, fileId, url };
}

export const fileResource: Resource = {
	value: 'file',
	name: 'File',
	description: 'Files in chats: upload, download, attach from Drive, save to Drive, delete',
	operations: [
		{
			value: 'upload',
			name: 'Upload',
			action: 'Upload a file to a chat',
			description: 'Send a file from the input binary data into a chat or private dialog, with an optional message; up to 100 MB',
			properties: [
				dialogIdProperty('Where to send the file'),
				{ displayName: 'Input Binary Field', name: 'binaryProperty', type: 'string', required: true, default: 'data', hint: 'The name of the input binary field containing the file to be uploaded' },
				{
					displayName: 'Additional Fields',
					name: 'additionalFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'File Name', name: 'fileName', type: 'string', default: '', description: 'Name with extension. Leave empty to keep the name of the binary data.' },
						{ displayName: 'Message', name: 'message', type: 'string', typeOptions: { rows: 3 }, default: '', description: 'Text sent together with the file' },
					],
				},
			],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const property = String(this.getNodeParameter('binaryProperty', itemIndex));
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const file = await binaryAsBase64(this, itemIndex, property);
				const fields: IDataObject = { name: String(o.fileName ?? '').trim() || file.fileName, content: file.content };
				if (o.message) fields.message = o.message as string;
				const body = await bitrix24Request.call(this, 'im.v2.File.upload', { dialogId, fields }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'download',
			name: 'Download',
			action: 'Download a file from a chat',
			description: 'Download a chat file into binary data',
			properties: [
				dialogIdProperty('The chat the file is in'),
				fileIdProperty,
				{ displayName: 'Put Output File in Field', name: 'binaryProperty', type: 'string', required: true, default: 'data', hint: 'The name of the output binary field to put the file in' },
			],
			async executeAll(this: IExecuteFunctions): Promise<INodeExecutionData[]> {
				const out: INodeExecutionData[] = [];
				const portal = await portalKey.call(this);
				const items = this.getInputData();
				for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
					try {
						const { dialogId, fileId, url } = await downloadLink(this, itemIndex);
						// The link carries the webhook code: downloadToBinary never lets it out.
						const binaryProperty = String(this.getNodeParameter('binaryProperty', itemIndex));
						out.push(await downloadToBinary(this, { url, portal, fileId, itemIndex, binaryProperty, json: { dialogId } }));
					} catch (error) {
						if (!this.continueOnFail()) throw asNodeError(this.getNode(), error, itemIndex);
						out.push({ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: itemIndex } });
					}
				}
				return out;
			},
		},
		{
			value: 'attachDriveFiles',
			name: 'Attach Drive Files',
			action: 'Send Drive files to a chat',
			description: 'Send files that are already on Drive into a chat or private dialog',
			properties: [
				dialogIdProperty('Where to send the files'),
				{ displayName: 'Drive File IDs', name: 'driveFileIds', type: 'string', required: true, default: '', placeholder: '5255, 5256', description: 'Comma-separated IDs of files on Drive' },
				{ displayName: 'Message', name: 'message', type: 'string', typeOptions: { rows: 3 }, default: '', description: 'Text sent together with the files' },
			],
			async execute(itemIndex) {
				const ids = idList(this, this.getNodeParameter('driveFileIds', itemIndex), 'Drive File IDs', itemIndex);
				if (ids.length === 0) throw new NodeOperationError(this.getNode(), 'Drive File IDs: give at least one file', { itemIndex });
				const params: IDataObject = { DIALOG_ID: readDialogId(this, itemIndex), FILE_ID: ids };
				const message = String(this.getNodeParameter('message', itemIndex, '') ?? '');
				if (message !== '') params.MESSAGE = message;
				const body = await bitrix24Request.call(this, 'im.disk.file.commit', params, { itemIndex });
				const result = (body.result ?? {}) as IDataObject;
				return { dialogId: params.DIALOG_ID, messageId: result.MESSAGE_ID ?? null, driveFileIds: (result.DISK_ID as number[] | undefined) ?? ids, files: result.FILES ?? {} };
			},
		},
		{
			value: 'saveToDrive',
			name: 'Save to Drive',
			action: 'Save a chat file to Drive',
			description: 'Copy a chat file into the Saved Files folder on the webhook user\'s Drive',
			properties: [fileIdProperty],
			async execute(itemIndex) {
				const fileId = positiveInt(this, 'fileId', itemIndex, 'File ID');
				const body = await bitrix24Request.call(this, 'im.disk.file.save', { FILE_ID: fileId }, { itemIndex });
				const result = (body.result ?? {}) as IDataObject;
				return { fileId, savedFile: result.file ?? null, folder: result.folder ?? null };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a file from a chat',
			description: 'Remove a file from a group chat',
			properties: [chatIdProperty('The chat the file is in'), fileIdProperty],
			async execute(itemIndex) {
				const params = { CHAT_ID: readChatId(this, itemIndex), FILE_ID: positiveInt(this, 'fileId', itemIndex, 'File ID') };
				await bitrix24Request.call(this, 'im.disk.file.delete', params, { itemIndex });
				return { chatId: params.CHAT_ID, fileId: params.FILE_ID, deleted: true };
			},
		},
		{
			value: 'getFolder',
			name: 'Get Chat Folder',
			action: 'Get the Drive folder of a chat',
			description: 'Get the ID of the Drive folder that keeps the files of a chat, for Drive methods',
			properties: [chatIdProperty()],
			async execute(itemIndex) {
				const chatId = readChatId(this, itemIndex);
				const body = await bitrix24Request.call(this, 'im.disk.folder.get', { CHAT_ID: chatId }, { itemIndex });
				return { chatId, folderId: Number((body.result as IDataObject | null)?.ID) || null };
			},
		},
	],
};
