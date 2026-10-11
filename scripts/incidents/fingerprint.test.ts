/**
 * fingerprint.test.ts — empreinte logique `<flux>:<classe>`, classes derivees des verdicts.
 */

import { describe, expect, it } from 'vitest';

import { httpsHeaders, type HttpsFlow } from '../silence-watchdog.js';
import type { FlowType, SymptomClass } from './envelope.js';
import { errorClassOf, failureClassOf, fingerprintOf, isErrorClass } from './fingerprint.js';
import { DB_FLUX } from './fixtures.js';

const LB2I_FLOW: HttpsFlow = {
  id: 'lb2i-pulse',
  label: 'LB2I, application',
  type: 'https',
  url: 'https://app.lb2i.com/api/health/pulse',
  expectStatus: 200,
  consecutiveFailures: 2,
  auth: { header: 'Authorization', env: 'LB2I_CRON_SECRET', prefix: 'Bearer ' },
};

const thrownBy = (fn: () => unknown): string => {
  try {
    fn();
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

describe('empreinte logique', () => {
  it('should derive the same fingerprint for two sightings whose details differ', () => {
    // Arrange : deux passages en alerte du meme flux, details differents (HTTP 502 puis injoignable)
    const first = failureClassOf('https');
    const second = failureClassOf('https');

    // Act
    const a = fingerprintOf('boxmail-server', first);
    const b = fingerprintOf('boxmail-server', second);

    // Assert
    expect(a).toBe('boxmail-server:http_ko');
    expect(b).toBe(a);
  });

  it('should build `<flux>:<classe>` as in the CHG-012 scenario', () => {
    expect(fingerprintOf(DB_FLUX, failureClassOf('github-commits'))).toBe('db-backups:silence');
  });

  it.each<[FlowType, SymptomClass]>([
    ['github-commits', 'silence'],
    ['github-file-date', 'silence'],
    ['github-workflow-runs', 'echec_workflow'],
    ['https', 'http_ko'],
  ])('should classify an alerting %s flow as %s', (type, expected) => {
    expect(failureClassOf(type)).toBe(expected);
  });
});

describe('classes d’erreur de contrôle', () => {
  it('should classify the error raised by httpsHeaders for a missing secret as secret_absent', () => {
    // Arrange : le vrai message du watchdog, pas une copie
    const message = thrownBy(() => httpsHeaders(LB2I_FLOW, {}));

    // Act
    const classe = errorClassOf(message);

    // Assert
    expect(message).toBe('secret LB2I_CRON_SECRET absent');
    expect(classe).toBe('secret_absent');
  });

  it('should classify any other control error as erreur', () => {
    expect(errorClassOf('GitHub HTTP 404 sur /repos/thonyAGP/db-backups/commits')).toBe('erreur');
    expect(errorClassOf('non contrôlé')).toBe('erreur');
  });

  it('should tell error classes (watchdog blind) from failure classes (stream down)', () => {
    expect(isErrorClass('erreur')).toBe(true);
    expect(isErrorClass('secret_absent')).toBe(true);
    expect(isErrorClass('silence')).toBe(false);
    expect(isErrorClass('http_ko')).toBe(false);
  });
});
