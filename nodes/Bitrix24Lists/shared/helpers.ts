import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * Every lists method starts the same way: the type of information block, then the list
 * itself by ID or by code. Bitrix24 refuses the call when the type does not match the
 * list, so both travel together through one helper.
 */
export const iblockTypeProperty: INodeProperties = {
	displayName: 'List Type',
	name: 'iblockType',
	type: 'options',
	default: 'lists',
	description: 'Where the list lives. A list of a workgroup is not the same type as one of the portal.',
	options: [
		{ name: 'Group Lists', value: 'lists_socnet', description: 'Lists inside a workgroup or a project' },
		{ name: 'Processes', value: 'bitrix_processes', description: 'Process lists of the news feed' },
		{ name: 'Universal Lists', value: 'lists', description: 'Lists of the portal, the usual kind' },
	],
};

export const iblockTypeCustomProperty: INodeProperties = {
	displayName: 'Custom List Type',
	name: 'iblockTypeCustom',
	type: 'string',
	default: '',
	placeholder: 'my_iblock_type',
	description:
		'Type of a self-hosted portal with its own information block types. It is used instead of List Type, and the list has to be named by ID or code.',
};

export const listIdProperty: INodeProperties = {
	displayName: 'List ID',
	name: 'iblockId',
	type: 'number',
	default: 0,
	description: 'ID of the list, as List → Get Many returns it. Give this or List Code.',
};

export const listCodeProperty: INodeProperties = {
	displayName: 'List Code',
	name: 'iblockCode',
	type: 'string',
	default: '',
	placeholder: 'vacation_requests',
	description: 'Symbolic code of the list, instead of its ID',
};

/** The three parameters every lists method opens with. */
export function listTarget(ctx: IExecuteFunctions, itemIndex: number, required = true): IDataObject {
	const custom = String(ctx.getNodeParameter('iblockTypeCustom', itemIndex, '')).trim();
	const params: IDataObject = {
		IBLOCK_TYPE_ID: custom !== '' ? custom : String(ctx.getNodeParameter('iblockType', itemIndex, 'lists')),
	};

	const id = Number(ctx.getNodeParameter('iblockId', itemIndex, 0));
	const code = String(ctx.getNodeParameter('iblockCode', itemIndex, '')).trim();
	if (Number.isInteger(id) && id > 0) params.IBLOCK_ID = id;
	if (code !== '') params.IBLOCK_CODE = code;

	if (required && params.IBLOCK_ID === undefined && params.IBLOCK_CODE === undefined) {
		throw new NodeOperationError(ctx.getNode(), 'Name the list by List ID or List Code', {
			itemIndex,
			description: 'Bitrix24 needs one of the two to know which list is meant.',
		});
	}
	if (custom !== '' && params.IBLOCK_ID === undefined && params.IBLOCK_CODE === undefined) {
		throw new NodeOperationError(ctx.getNode(), 'A custom list type needs List ID or List Code', { itemIndex });
	}

	return params;
}

/** The same three, as the properties of an operation. */
export function listTargetProperties(required = true): INodeProperties[] {
	return [
		iblockTypeProperty,
		iblockTypeCustomProperty,
		required ? { ...listIdProperty, description: `${listIdProperty.description} Required unless List Code is set.` } : listIdProperty,
		listCodeProperty,
	];
}

/** An element or a section is named by ID or by code, the same way the list is. */
export function nameById(
	ctx: IExecuteFunctions,
	itemIndex: number,
	idName: string,
	codeName: string,
	idKey: string,
	codeKey: string,
	label: string,
	required = true,
): IDataObject {
	const params: IDataObject = {};
	const id = Number(ctx.getNodeParameter(idName, itemIndex, 0));
	const code = String(ctx.getNodeParameter(codeName, itemIndex, '')).trim();
	if (Number.isInteger(id) && id > 0) params[idKey] = id;
	if (code !== '') params[codeKey] = code;

	if (required && Object.keys(params).length === 0) {
		throw new NodeOperationError(ctx.getNode(), `Name the ${label} by its ID or its code`, { itemIndex });
	}
	return params;
}
