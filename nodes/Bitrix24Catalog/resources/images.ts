import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { asNodeError } from '../../../shared/errors';
import { extractRows } from '../../../shared/list';
import { positiveInt } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request, portalKey } from '../../../shared/transport';
import { binaryAsBase64 } from '../../Bitrix24Messenger/shared/helpers';

const productIdProperty: INodeProperties = {
	displayName: 'Product ID',
	name: 'productId',
	type: 'number',
	required: true,
	default: 0,
	description: 'ID of the product, product with variations, variation or service',
};

const imageIdProperty: INodeProperties = {
	displayName: 'Image ID',
	name: 'imageId',
	type: 'number',
	required: true,
	default: 0,
	description: 'ID of the image, as Get Many returns it',
};

/**
 * downloadUrl is `/rest/<user>/<webhook code>/download/?token=…`: it carries the webhook secret, so
 * it never reaches the output. Through a webhook it does not even work — it answers
 * ERROR_METHOD_NOT_FOUND (live portal, 19.09.2026) — so Download takes detailUrl, the public link
 * of the same file, instead.
 */
function withoutLink(image: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(image)) if (key !== 'downloadUrl') out[key] = value;
	return out;
}

async function readImage(ctx: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const body = await bitrix24Request.call(
		ctx,
		'catalog.productImage.get',
		{ productId: positiveInt(ctx, 'productId', itemIndex, 'Product ID'), id: positiveInt(ctx, 'imageId', itemIndex, 'Image ID') },
		{ itemIndex },
	);
	return ((body.result as IDataObject)?.productImage ?? {}) as IDataObject;
}

/** Fetches the public link of an image: a CDN or /upload/ address that holds no secret. */
async function publicFile(ctx: IExecuteFunctions, image: IDataObject, portal: string, itemIndex: number, binaryProperty: string): Promise<INodeExecutionData> {
	const link = String(image.detailUrl ?? '');
	if (link === '') throw new NodeOperationError(ctx.getNode(), 'Bitrix24 gave no link for this image', { itemIndex });
	let url: URL;
	try {
		url = new URL(link, portal);
	} catch {
		throw new NodeOperationError(ctx.getNode(), 'The link of this image is not an address', { itemIndex });
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new NodeOperationError(ctx.getNode(), 'The link of this image is not a web address', { itemIndex });
	}
	const response = (await ctx.helpers.httpRequest({ method: 'GET', url: url.href, encoding: 'arraybuffer', returnFullResponse: true, ignoreHttpStatusErrors: true })) as IDataObject;
	const status = Number(response.statusCode) || 0;
	if (status < 200 || status >= 300) {
		throw new NodeOperationError(ctx.getNode(), `Image ${String(image.id)} could not be downloaded: HTTP ${status}`, { itemIndex });
	}
	const headers = (response.headers ?? {}) as IDataObject;
	const buffer = Buffer.from(response.body as ArrayBuffer);
	const fileName = typeof image.name === 'string' && image.name !== '' ? image.name : `image-${String(image.id)}`;
	const mimeType = String(headers['content-type'] ?? 'application/octet-stream').split(';')[0];
	return {
		json: { ...withoutLink(image), fileName, mimeType, size: buffer.length },
		binary: { [binaryProperty]: await ctx.helpers.prepareBinaryData(buffer, fileName, mimeType) },
		pairedItem: { item: itemIndex },
	};
}

export const productImageResource: Resource = {
	value: 'productImage',
	name: 'Product Image',
	description: 'Pictures of products, variations and services',
	operations: [
		{
			value: 'upload',
			name: 'Upload',
			action: 'Upload a product image',
			description: 'Add a picture from binary data to a product, variation or service',
			properties: [
				productIdProperty,
				{
					displayName: 'Image Type',
					name: 'imageType',
					type: 'options',
					default: 'MORE_PHOTO',
					options: [
						{ name: 'Detail Picture', value: 'DETAIL_PICTURE', description: 'The large picture of the old product card' },
						{ name: 'Gallery Picture', value: 'MORE_PHOTO', description: 'One more picture in the gallery of the product card' },
						{ name: 'Preview Picture', value: 'PREVIEW_PICTURE', description: 'The small picture of the old product card' },
					],
				},
				{
					displayName: 'Input Binary Field',
					name: 'binaryProperty',
					type: 'string',
					required: true,
					default: 'data',
					hint: 'The name of the input binary field containing the image to be uploaded',
				},
			],
			async execute(itemIndex) {
				const productId = positiveInt(this, 'productId', itemIndex, 'Product ID');
				const file = await binaryAsBase64(this, itemIndex, String(this.getNodeParameter('binaryProperty', itemIndex)));
				const body = await bitrix24Request.call(
					this,
					'catalog.productImage.add',
					{ fields: { productId, type: this.getNodeParameter('imageType', itemIndex) }, fileContent: [file.fileName, file.content] },
					{ itemIndex },
				);
				return withoutLink(((body.result as IDataObject)?.productImage ?? {}) as IDataObject);
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a product image',
			description: 'Read one picture of a product: its name, type and public link',
			properties: [productIdProperty, imageIdProperty],
			async execute(itemIndex) {
				return withoutLink(await readImage(this, itemIndex));
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many product images',
			description: 'Read every picture of a product',
			properties: [productIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'catalog.productImage.list', { productId: positiveInt(this, 'productId', itemIndex, 'Product ID') }, { itemIndex });
				return extractRows(body.result, 'productImages').map(withoutLink);
			},
		},
		{
			value: 'download',
			name: 'Download',
			action: 'Download a product image',
			description: 'Fetch one picture of a product into binary data',
			properties: [
				productIdProperty,
				imageIdProperty,
				{
					displayName: 'Put Output File in Field',
					name: 'binaryProperty',
					type: 'string',
					required: true,
					default: 'data',
					hint: 'The name of the output binary field to put the file in',
				},
			],
			async executeAll(this: IExecuteFunctions): Promise<INodeExecutionData[]> {
				const out: INodeExecutionData[] = [];
				const portal = await portalKey.call(this);
				const items = this.getInputData();
				for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
					try {
						const image = await readImage(this, itemIndex);
						out.push(await publicFile(this, image, portal, itemIndex, String(this.getNodeParameter('binaryProperty', itemIndex))));
					} catch (error) {
						if (!this.continueOnFail()) throw asNodeError(this.getNode(), error, itemIndex);
						out.push({ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: itemIndex } });
					}
				}
				return out;
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a product image',
			description: 'Remove one picture from a product',
			properties: [productIdProperty, imageIdProperty],
			async execute(itemIndex) {
				const productId = positiveInt(this, 'productId', itemIndex, 'Product ID');
				const id = positiveInt(this, 'imageId', itemIndex, 'Image ID');
				await bitrix24Request.call(this, 'catalog.productImage.delete', { productId, id }, { itemIndex });
				return { productId, id, deleted: true };
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get product image fields',
			description: 'Describe the fields a product image has',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'catalog.productImage.getFields', {}, { itemIndex });
				const fields = ((body.result as IDataObject)?.productImage ?? {}) as IDataObject;
				return Object.entries(fields).map(([name, meta]) => ({ name, ...(meta as IDataObject) }));
			},
		},
	],
};
