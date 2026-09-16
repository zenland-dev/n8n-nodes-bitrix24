import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { extractRows } from '../../../shared/list';
import { compact, idParameter, returnAllProperties } from '../../../shared/params';
import { stringProperty } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList } from '../../../shared/values';
import { optionalDay } from '../shared/helpers';

const resourceIdProperty: INodeProperties = {
	displayName: 'Resource Name or ID',
	name: 'resourceId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getResources' },
	default: '',
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	hint: 'The rooms, cars and other things clients book',
};

export const bookingResourceResource: Resource = {
	value: 'bookingResource',
	name: 'Booking Resource',
	description: 'The rooms, cars and equipment a CRM resource booking field offers',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a booking resource',
			description:
				'Add a resource. It appears in the list at once, but it starts taking bookings only after a resource booking field in a lead or deal form is set to offer it.',
			properties: [stringProperty('Name', 'name', 'Name of the resource, as it appears in the booking field', true)],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(
					this,
					'calendar.resource.add',
					{ name: this.getNodeParameter('name', itemIndex) },
					{ itemIndex },
				);
				return { id: Number(body.result) };
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Rename a booking resource',
			description: 'Change the name of a resource. The name is all a resource has.',
			properties: [resourceIdProperty, stringProperty('Name', 'name', 'New name of the resource', true)],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(
					this,
					'calendar.resource.update',
					{ resourceId: idParameter(this, 'resourceId', itemIndex), name: this.getNodeParameter('name', itemIndex) },
					{ itemIndex },
				);
				return { id: Number(body.result) };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a booking resource',
			description: 'Remove a resource together with the bookings made for it',
			properties: [resourceIdProperty],
			async execute(itemIndex) {
				await bitrix24Request.call(
					this,
					'calendar.resource.delete',
					{ resourceId: idParameter(this, 'resourceId', itemIndex) },
					{ itemIndex },
				);
				return undefined;
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many booking resources',
			description: 'List every resource on the portal, with the user who created each one',
			properties: returnAllProperties('resources'),
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'calendar.resource.list', {}, { itemIndex });
				const rows = extractRows(body.result);
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				return returnAll ? rows : rows.slice(0, this.getNodeParameter('limit', itemIndex) as number);
			},
		},
		{
			value: 'getBookings',
			name: 'Get Bookings',
			action: 'Get bookings of resources',
			description: 'List the bookings made for resources, or look up bookings by the IDs a CRM record holds',
			properties: [
				{
					displayName: 'Look Up By',
					name: 'lookUpBy',
					type: 'options',
					default: 'resources',
					options: [
						{ name: 'Booking ID', value: 'bookings', description: 'The IDs kept in a CRM resource booking field' },
						{ name: 'Resource', value: 'resources', description: 'Everything booked for the given resources' },
					],
					description: 'Bitrix24 takes one of the two, never both at once',
				},
				{
					displayName: 'Resource IDs',
					name: 'resourceTypeIds',
					type: 'string',
					required: true,
					default: '',
					placeholder: '5, 8',
					displayOptions: { show: { lookUpBy: ['resources'] } },
					description: 'Comma-separated IDs of the resources, as Get Many returns them',
				},
				{
					displayName: 'Booking IDs',
					name: 'bookingIds',
					type: 'string',
					required: true,
					default: '',
					placeholder: '31, 32',
					displayOptions: { show: { lookUpBy: ['bookings'] } },
					description:
						'Comma-separated booking IDs, as a resource booking field of a lead or deal holds them. Read the field with the Bitrix24 CRM node.',
				},
				{
					displayName: 'From',
					name: 'from',
					type: 'dateTime',
					default: '',
					description: 'First day of the period to look at',
				},
				{
					displayName: 'To',
					name: 'to',
					type: 'dateTime',
					default: '',
					description: 'Last day of the period to look at',
				},
				...returnAllProperties('bookings'),
			],
			async execute(itemIndex) {
				const lookUpBy = String(this.getNodeParameter('lookUpBy', itemIndex));
				const label = lookUpBy === 'bookings' ? 'Booking IDs' : 'Resource IDs';
				const ids = idList(
					this,
					this.getNodeParameter(lookUpBy === 'bookings' ? 'bookingIds' : 'resourceTypeIds', itemIndex),
					label,
					itemIndex,
				);
				if (ids.length === 0) {
					throw new NodeOperationError(this.getNode(), `${label} is empty`, {
						itemIndex,
						description: 'Bitrix24 needs either a list of resources or a list of booking IDs.',
					});
				}

				const filter = compact({
					[lookUpBy === 'bookings' ? 'resourceIdList' : 'resourceTypeIdList']: ids,
					from: optionalDay(this, this.getNodeParameter('from', itemIndex, ''), 'From', itemIndex),
					to: optionalDay(this, this.getNodeParameter('to', itemIndex, ''), 'To', itemIndex),
				}) as IDataObject;

				const body = await bitrix24Request.call(this, 'calendar.resource.booking.list', { filter }, { itemIndex });
				const rows = extractRows(body.result);
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				return returnAll ? rows : rows.slice(0, this.getNodeParameter('limit', itemIndex) as number);
			},
		},
	],
};
