(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  function selectedOltDetails() {
    const select = document.querySelector(
      'select#dopfield_29,select[name="dopfield_29"]'
    );
    const option = select?.options?.[select.selectedIndex] || null;
    const text = String(option?.textContent || '').replace(/\s+/g, ' ').trim();
    const oltIp = text.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/)?.[1] || '';
    const tech = WB.locatorSignals?.technologyFromName?.(text)
      || { type: '', action: '' };
    const onuMac = String(
      document.querySelector('input[name="dopfield_19"]')?.value || ''
    ).trim();
    const onuSerial = String(
      document.querySelector('input[name="dopfield_38"]')?.value || ''
    ).trim();
    const activeCase = WB.store?.activeCase?.() || null;
    const rec = activeCase?.locator?.recommendation || null;
    let requiredFields = Array.isArray(rec?.params?.fields)
      ? rec.params.fields.slice()
      : ['olt'];
    const expectedTechnical = rec?.params?.expectedTechnical
      && typeof rec.params.expectedTechnical === 'object'
      ? { ...rec.params.expectedTechnical }
      : {};
    const autoNameResolved = select?.dataset?.simnetWbAutoOlt === '1';
    if (autoNameResolved) {
      requiredFields = ['olt'];
      // The network candidate may use a long UserSide equipment title while Billing
      // stores a short operational alias. Once the resolver found one unambiguous
      // Billing option, post-save verification must compare against that real option,
      // not against the source label that led us to it.
      expectedTechnical.oltName = text.replace(oltIp, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
      expectedTechnical.oltIp = oltIp;
    }
    return {
      selectedValue: String(select?.value || ''),
      oltName: text.replace(oltIp, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(),
      oltIp,
      onuMac,
      onuSerial,
      requiredFields,
      expectedTechnical,
      technology: tech.type,
      pollAction: tech.action,
      sourceDocumentId: WB.runtime.documentId || '',
      resolvedBy: autoNameResolved ? 'billing_olt_name' : '',
      sourceOltName: autoNameResolved ? String(select?.dataset?.simnetWbAutoOltSource || '') : '',
      deviceId: autoNameResolved ? String(select?.dataset?.simnetWbAutoOltDeviceId || '') : '',
      interface: autoNameResolved ? String(select?.dataset?.simnetWbAutoOltInterface || '') : ''
    };
  }

  function billingTechnicalSaveControl(target) {
    if (!(target instanceof Element)) return null;
    const control = target.closest(
      '#savediv1 input[type="submit"],' +
      '#savediv1 button[type="submit"],' +
      'input.button[type="submit"][value*="Сохран"],' +
      'input.button[type="submit"][value*="Зберег"],' +
      'button[type="submit"]'
    );
    if (!control) return null;
    const system = WB.contextEngine?.detectSystem?.();
    const page = WB.contextEngine?.detectPageKind?.(system);
    return page?.kind === 'billing_technical' ? control : null;
  }

  document.addEventListener('click', event => {
    if (!billingTechnicalSaveControl(event.target)) return;
    const details = selectedOltDetails();

    chrome.runtime.sendMessage({
      type: 'LOCATOR_APPLY_OBSERVATION',
      payload: {
        caseId: String(WB.store?.localCaseId || ''),
        envelope: WB.store?.correlation?.(
          'LOCATOR_APPLY_OBSERVATION',
          {},
          { caseId: String(WB.store?.localCaseId || '') }
        ) || null,
        observation: {
          type: 'BILLING_OLT_SAVE_INTENT',
          result: 'intent',
          method: 'native-save-click',
          source: 'billing',
          details,
          summary: 'Отправлена форма сохранения технических данных; Workbench проверит только поля текущего маршрута.'
        }
      }
    }).catch(() => {});
  }, true);
})();
