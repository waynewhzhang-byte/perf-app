'use client';

import { useEffect, useState } from 'react';

export type PublicAuthConfig = {
  registerRequiresVerification: boolean;
  loginRequiresVerification: boolean;
  resetRequiresVerification: boolean;
  enforceStrongPassword: boolean;
};

const defaults: PublicAuthConfig = {
  registerRequiresVerification: true,
  loginRequiresVerification: false,
  resetRequiresVerification: true,
  enforceStrongPassword: true,
};

export function useAuthConfig() {
  const [config, setConfig] = useState<PublicAuthConfig>(defaults);
  const [passwordHint, setPasswordHint] = useState('密码至少 8 位');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/public/auth-config')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setConfig(d.config);
          setPasswordHint(d.passwordHint ?? '密码至少 8 位');
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  return { config, passwordHint, loaded };
}
