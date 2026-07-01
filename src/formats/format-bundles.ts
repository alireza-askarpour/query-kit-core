import { Provider, Type } from '@nestjs/common';
import { FilterFormatRegistration } from '../core/services/filter-registry.service';
import { MCFormat, MCFormatValidator } from './mc';
import { SCFormat, SCFormatValidator } from './sc';

export const FILTER_FORMAT_REGISTRATIONS = 'FILTER_FORMAT_REGISTRATIONS';

export const DEFAULT_FORMAT_CLASSES: Type[] = [
  SCFormat,
  SCFormatValidator,
  MCFormat,
  MCFormatValidator,
];

export const DEFAULT_FORMAT_EXPORTS: Array<Type | string> = [
  SCFormat,
  SCFormatValidator,
  MCFormat,
  MCFormatValidator,
  FILTER_FORMAT_REGISTRATIONS,
];

export const DEFAULT_FORMAT_PROVIDERS: Provider[] = [
  SCFormat,
  SCFormatValidator,
  MCFormat,
  MCFormatValidator,
  {
    provide: FILTER_FORMAT_REGISTRATIONS,
    inject: DEFAULT_FORMAT_CLASSES,
    useFactory: (
      scFormat: SCFormat,
      scValidator: SCFormatValidator,
      mcFormat: MCFormat,
      mcValidator: MCFormatValidator,
    ): FilterFormatRegistration[] => [
      {
        format: scFormat,
        validator: scValidator,
      },
      {
        format: mcFormat,
        validator: mcValidator,
      },
    ],
  },
];
