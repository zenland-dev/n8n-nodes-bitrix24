import type { IDataObject, INodeProperties } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import { jsonParameter, returnAllProperties } from '../../../shared/params';
import { positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { anyCatalogProperty, catalogCrud, catalogFilter, catalogProperty } from '../shared/helpers';

export const sectionResource: Resource = {
	value: 'section',
	name: 'Section',
	description: 'Sections of the product catalog, the folders products are grouped into',
	operations: [
		...catalogCrud({
			prefix: 'catalog.section',
			key: 'section',
			noun: 'section',
			plural: 'sections',
			kinds: ['create', 'getMany', 'update'],
			context: [catalogProperty('product')],
			baseFields: catalogFilter,
			baseFieldsOnUpdate: true,
			baseFilter: catalogFilter,
			fieldsExample: '{"name": "Chairs", "iblockSectionId": 12, "sort": 100, "active": "Y"}',
			descriptions: {
				create: 'Add a section to the catalog; iblockSectionId makes it a subsection',
				getMany: 'Read the sections of a catalog, all of them or the ones a filter names',
			},
		}),
		...catalogCrud({
			prefix: 'catalog.section',
			key: 'section',
			noun: 'section',
			plural: 'sections',
			kinds: ['get', 'delete', 'getFields'],
			fieldsExample: '{}',
			descriptions: { delete: 'Delete a section; its products stay in the catalog' },
		}),
	],
};

export const propertyResource: Resource = {
	value: 'property',
	name: 'Property',
	description: 'Properties products and variations carry: material, color, article number, files',
	operations: [
		...catalogCrud({
			prefix: 'catalog.productProperty',
			key: 'productProperty',
			noun: 'property',
			plural: 'properties',
			kinds: ['create', 'getMany', 'update'],
			context: [anyCatalogProperty],
			baseFields: catalogFilter,
			baseFieldsOnUpdate: true,
			baseFilter: catalogFilter,
			fieldsExample: '{"name": "Material", "code": "MATERIAL", "propertyType": "S", "multiple": "N"}',
			descriptions: {
				create: 'Add a property. propertyType is S for text, N for number, L for a list, F for a file, E for a link to another element.',
				getMany: 'Read the properties of a catalog with their IDs, codes and types',
			},
		}),
		...catalogCrud({
			prefix: 'catalog.productProperty',
			key: 'productProperty',
			noun: 'property',
			plural: 'properties',
			kinds: ['get', 'delete', 'getFields'],
			fieldsExample: '{}',
			descriptions: { delete: 'Delete a property together with every value products hold in it' },
		}),
	],
};

export const propertyValueResource: Resource = {
	value: 'propertyValue',
	name: 'Property List Value',
	description: 'The choices of a list property, e.g. the colors a Color property offers',
	operations: catalogCrud({
		prefix: 'catalog.productPropertyEnum',
		key: 'productPropertyEnum',
		noun: 'list value',
		plural: 'list values',
		fieldsExample: '{"propertyId": 258, "value": "Red", "xmlId": "red", "sort": 100, "def": "N"}',
		descriptions: { getMany: 'Read list values, e.g. of one property with the filter {"propertyId": 258}' },
	}),
};

export const propertyFeatureResource: Resource = {
	value: 'propertyFeature',
	name: 'Property Feature',
	description: 'Where a property is used beyond the card: in variation selection, in the store card',
	operations: [
		...catalogCrud({
			prefix: 'catalog.productPropertyFeature',
			key: 'productPropertyFeature',
			noun: 'property feature',
			plural: 'property features',
			kinds: ['create', 'get', 'getMany', 'update', 'getFields'],
			fieldsExample: '{"propertyId": 258, "moduleId": "catalog", "featureId": "OFFER_TREE", "isEnabled": "Y"}',
			descriptions: { create: 'Switch a feature on for a property; Get Available lists the ones it can take' },
		}),
		{
			value: 'getAvailable',
			name: 'Get Available',
			action: 'Get the features a property can take',
			description: 'List the features one property can be given',
			properties: [{ displayName: 'Property ID', name: 'propertyId', type: 'number', required: true, default: 0, description: 'ID of the property' }],
			async execute(itemIndex) {
				const propertyId = positiveInt(this, 'propertyId', itemIndex, 'Property ID');
				const body = await bitrix24Request.call(this, 'catalog.productPropertyFeature.getAvailableFeaturesByProperty', { propertyId }, { itemIndex });
				return rows(body.result, 'features');
			},
		},
	],
};

const propertyIdProperty: INodeProperties = {
	displayName: 'Property ID',
	name: 'propertyId',
	type: 'number',
	required: true,
	default: 0,
	description: 'ID of the property',
};

export const propertySettingResource: Resource = {
	value: 'propertySectionSetting',
	name: 'Property Filter Setting',
	description: 'How a property shows in the smart filter of the catalog sections',
	operations: [
		{
			value: 'get',
			name: 'Get',
			action: 'Get the filter settings of a property',
			description: 'Read how one property shows in the smart filter',
			properties: [propertyIdProperty],
			async execute(itemIndex) {
				const propertyId = positiveInt(this, 'propertyId', itemIndex, 'Property ID');
				const body = await bitrix24Request.call(this, 'catalog.productPropertySection.get', { propertyId }, { itemIndex });
				return rows(body.result, 'productPropertySection');
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many property filter settings',
			description: 'Read the smart filter settings of every property',
			properties: [
				...returnAllProperties('settings'),
				{ displayName: 'Filter (JSON)', name: 'filterJson', type: 'json', default: '{}', description: 'Filter object, e.g. {"smartFilter": "Y"}' },
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				const params: IDataObject = Object.keys(filter).length > 0 ? { filter } : {};
				return await listAll.call(this, 'catalog.productPropertySection.list', params, { itemsKey: 'productPropertySections', limit, itemIndex });
			},
		},
		{
			value: 'set',
			name: 'Set',
			action: 'Set the filter settings of a property',
			description: 'Choose whether and how a property shows in the smart filter',
			properties: [
				propertyIdProperty,
				{
					displayName: 'Settings',
					name: 'settings',
					type: 'collection',
					placeholder: 'Add Setting',
					default: {},
					options: [
						{
							displayName: 'Display Type',
							name: 'displayType',
							type: 'options',
							default: 'F',
							options: [
								{ name: 'Checkboxes', value: 'F' },
								{ name: 'Dropdown List', value: 'P' },
								{ name: 'Radio Buttons', value: 'K' },
							],
							description: 'How the property is picked in the filter',
						},
						{ displayName: 'Expanded', name: 'displayExpanded', type: 'boolean', default: false, description: 'Whether the property shows unfolded' },
						{ displayName: 'Hint', name: 'filterHint', type: 'string', default: '', description: 'Tip for store visitors' },
						{ displayName: 'In Smart Filter', name: 'smartFilter', type: 'boolean', default: true, description: 'Whether the property shows in the smart filter' },
					],
				},
			],
			async execute(itemIndex) {
				const propertyId = positiveInt(this, 'propertyId', itemIndex, 'Property ID');
				const chosen = (this.getNodeParameter('settings', itemIndex, {}) ?? {}) as IDataObject;
				const fields: IDataObject = {};
				for (const [key, value] of Object.entries(chosen)) {
					if (typeof value === 'boolean') fields[key] = value ? 'Y' : 'N';
					else if (value !== '') fields[key] = value;
				}
				const body = await bitrix24Request.call(this, 'catalog.productPropertySection.set', { propertyId, fields }, { itemIndex });
				return rows(body.result, 'productPropertySection');
			},
		},
	],
};
