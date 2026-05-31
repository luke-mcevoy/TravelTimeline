import { useState } from 'react';
import { X, Loader2, Save } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { updateProfile, updateAvatar, heroUrl } from '@/services/social';
import { socialMock } from '@/services/supabase';
import styles from './MyProfileSheet.module.css';

interface Props {
  onClose: () => void;
}

export function MyProfileSheet({ onClose }: Props) {
  const profile = useAuthStore((s) => s.profile);
  const reloadProfile = useAuthStore((s) => s.reloadProfile);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateProfile(profile.id, {
        displayName: name.trim() || null,
        bio: bio.trim() || null,
      });
      await reloadProfile();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const onAvatarPick = () => {
    if (!socialMock) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        await updateAvatar(profile.id, dataUrl);
        await reloadProfile();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const av = heroUrl(profile.avatar_url);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2 className={styles.title}>Your profile</h2>
        <p className={styles.sub}>How friends see you on TravelTimeline</p>

        <button type="button" className={styles.avatarBtn} onClick={onAvatarPick}>
          {av ? <img className={styles.avatar} src={av} alt="" /> : <div className={styles.avatarPh} />}
          {socialMock && <span className={styles.avatarHint}>Tap to change photo</span>}
        </button>

        <label className={styles.label}>
          Display name
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
          />
        </label>

        <label className={styles.label}>
          Bio
          <textarea
            className={styles.textarea}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Where you travel, how you shoot, what you share…"
            maxLength={280}
            rows={4}
          />
        </label>

        <p className={styles.handleNote}>@{profile.handle}</p>

        {error && <p className={styles.error}>{error}</p>}

        <button type="button" className={styles.save} disabled={busy} onClick={save}>
          {busy ? <Loader2 className={styles.spin} /> : <Save size={16} />}
          Save profile
        </button>
      </div>
    </div>
  );
}
