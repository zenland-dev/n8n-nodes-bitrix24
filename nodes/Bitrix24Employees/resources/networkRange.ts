import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { compact } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { valuesOf } from '../../../shared/offset';

export const networkRangeResource: Resource = {
	value: 'networkRange',
	name: 'Office Network',
	description: 'The address ranges the portal treats as the office, for starting a working day from there',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the office network ranges',
			description: 'List the address ranges the portal counts as the office. Needs an administrator webhook.',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'timeman.networkrange.get', {}, { itemIndex });
				return valuesOf(body.result);
			},
		},
		{
			value: 'set',
			name: 'Set',
			action: 'Set the office network ranges',
			description:
				'Replace the whole list of office ranges. What is not in the list stops being the office. Needs an administrator webhook.',
			properties: [
				{
					displayName: 'Ranges',
					name: 'ranges',
					type: 'fixedCollection',
					typeOptions: { multipleValues: true },
					placeholder: 'Add Range',
					default: {},
					description: 'Every range the portal should treat as the office',
					options: [
						{
							displayName: 'Range',
							name: 'range',
							values: [
								{
									displayName: 'Addresses',
									name: 'ip_range',
									type: 'string',
									default: '',
									placeholder: '10.0.0.0-10.255.255.255',
									description: 'One address, or a block written as first-last',
								},
								{
									displayName: 'Name',
									name: 'name',
									type: 'string',
									default: '',
									description: 'What to call this range, e.g. the office it belongs to',
								},
							],
						},
					],
				},
			],
			async execute(itemIndex) {
				const entries = (this.getNodeParameter('ranges.range', itemIndex, []) ?? []) as IDataObject[];
				const ranges = entries
					.filter((e) => String(e.ip_range ?? '').trim() !== '')
					.map((e) => compact({ ip_range: String(e.ip_range).trim(), name: e.name }));

				if (ranges.length === 0) {
					throw new NodeOperationError(this.getNode(), 'No range given', {
						itemIndex,
						description:
							'Add at least one range. Sending an empty list would leave the portal without an office network.',
					});
				}

				const body = await bitrix24Request.call(this, 'timeman.networkrange.set', { RANGES: ranges }, { itemIndex });
				// The method answers false and names the ranges it did not understand.
				if (body.result === false) {
					throw new NodeOperationError(this.getNode(), 'Bitrix24 refused some of the ranges', {
						itemIndex,
						description: `Check the addresses: ${JSON.stringify(body.error_range ?? [])}`,
					});
				}
				return undefined;
			},
		},
		{
			value: 'check',
			name: 'Check',
			action: 'Check whether an address is in the office network',
			description:
				'Tell whether an address belongs to one of the office ranges, and which one. Needs an administrator webhook.',
			properties: [
				{
					displayName: 'IP Address',
					name: 'ip',
					type: 'string',
					default: '',
					placeholder: '10.10.255.25',
					description: 'Address to check. Empty checks the address the request itself comes from.',
				},
			],
			async execute(itemIndex) {
				const ip = String(this.getNodeParameter('ip', itemIndex, '')).trim();
				const body = await bitrix24Request.call(
					this,
					'timeman.networkrange.check',
					compact({ IP: ip === '' ? undefined : ip }),
					{ itemIndex },
				);
				// An address outside every range answers false rather than an empty object.
				if (body.result === false || body.result === null) return { inOffice: false };
				return { inOffice: true, ...((body.result ?? {}) as IDataObject) };
			},
		},
	],
};
