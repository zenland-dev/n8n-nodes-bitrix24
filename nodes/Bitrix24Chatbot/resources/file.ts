import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { downloadToBinary } from '../../../shared/download';
import { asNodeError } from '../../../shared/errors';
import type { Resource } from '../../../shared/spec';
import { CHATBOT_CREDENTIAL, portalKey } from '../../../shared/transport';
import { binaryAsBase64 } from '../../Bitrix24Messenger/shared/helpers';
import { botIdProperty, botRequest, dialogIdProperty, readBotId, readDialogId, readPositive } from '../shared/bot';

export const fileResource: Resource = {
	value: 'file',
	name: 'File',
	description: 'Files the bot sends into chats, and files it downloads from them',
	operations: [
		{
			value: 'upload',
			name: 'Upload',
			action: 'Send a file as the bot',
			description: 'Send a file from the input binary data into a chat or private dialog on behalf of the bot, with an optional message; up to 100 MB',
			properties: [
				botIdProperty,
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
				const botId = readBotId(this, itemIndex);
				const dialogId = readDialogId(this, itemIndex);
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const file = await binaryAsBase64(this, itemIndex, String(this.getNodeParameter('binaryProperty', itemIndex)));
				const fields: IDataObject = { name: String(o.fileName ?? '').trim() || file.fileName, content: file.content };
				if (o.message) fields.message = o.message as string;
				const body = await botRequest.call(this, 'imbot.v2.File.upload', { botId, dialogId, fields }, itemIndex);
				const result = (body.result ?? {}) as IDataObject;
				const uploaded = (result.file ?? {}) as IDataObject;
				return { fileId: uploaded.id ?? null, messageId: result.messageId ?? null, chatId: result.chatId ?? null, dialogId: result.dialogId ?? dialogId, file: uploaded };
			},
		},
		{
			value: 'download',
			name: 'Download',
			action: 'Download a chat file as the bot',
			description: 'Download a file from a chat of the bot into binary data',
			properties: [
				botIdProperty,
				{ displayName: 'File ID', name: 'fileId', type: 'number', required: true, default: 0, description: 'ID of the file on Drive, as Upload returns it or a message lists it under params' },
				{ displayName: 'Put Output File in Field', name: 'binaryProperty', type: 'string', required: true, default: 'data', hint: 'The name of the output binary field to put the file in' },
			],
			async executeAll(this: IExecuteFunctions): Promise<INodeExecutionData[]> {
				const out: INodeExecutionData[] = [];
				const portal = await portalKey.call(this, CHATBOT_CREDENTIAL);
				const items = this.getInputData();
				for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
					try {
						const botId = readBotId(this, itemIndex);
						const fileId = readPositive(this, 'fileId', itemIndex, 'File ID');
						const body = await botRequest.call(this, 'imbot.v2.File.download', { botId, fileId }, itemIndex);
						// The link is one-time and, for a webhook, carries the webhook code: never output, see downloadToBinary.
						const url = String((body.result as IDataObject | null)?.downloadUrl ?? '');
						if (url === '') throw new NodeOperationError(this.getNode(), `Bitrix24 gave no download link for file ${fileId}`, { itemIndex });
						const binaryProperty = String(this.getNodeParameter('binaryProperty', itemIndex));
						out.push(await downloadToBinary(this, { url, portal, fileId, itemIndex, binaryProperty, json: { botId } }));
					} catch (error) {
						if (!this.continueOnFail()) throw asNodeError(this.getNode(), error, itemIndex);
						out.push({ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: itemIndex } });
					}
				}
				return out;
			},
		},
	],
};
