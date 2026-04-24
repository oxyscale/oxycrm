import { useState, useEffect } from 'react';
import {
  Save,
  Loader2,
  Check,
  Plus,
  Trash2,
  Building2,
  Mail,
  MessageSquareText,
  Pen,
} from 'lucide-react';
import * as api from '../services/api';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';

// ── Types ───────────────────────────────────────────────────

type Tab = 'prompts' | 'company' | 'email' | 'signature';

// ── Main Component ──────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('prompts');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Category prompts
  const [prompts, setPrompts] = useState<api.CategoryPrompt[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedPrompt, setSavedPrompt] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);

  // Available categories from leads
  const [categories, setCategories] = useState<string[]>([]);

  // ── Load data ─────────────────────────────────────────────

  useEffect(() => {
    loadSettings();
    loadPrompts();
    loadCategories();
  }, []);

  const loadSettings = async () => {
    setLoadingSettings(true);
    try {
      const data = await api.getSettings();
      setSettings(data);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoadingSettings(false);
    }
  };

  const loadPrompts = async () => {
    setLoadingPrompts(true);
    try {
      const data = await api.getCategoryPrompts();
      setPrompts(data);
    } catch (err) {
      console.error('Failed to load category prompts:', err);
    } finally {
      setLoadingPrompts(false);
    }
  };

  const loadCategories = async () => {
    try {
      const cats = await api.getCategories();
      setCategories(cats);
    } catch {
      // Non-critical
    }
  };

  // ── Settings handlers ─────────────────────────────────────

  const updateSetting = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ── Category prompt handlers ─────────────────────────────

  const selectCategory = (category: string) => {
    setActiveCategory(category);
    setSavedPrompt(false);
    const existing = prompts.find((p) => p.category === category);
    setPromptDraft(existing?.prompt || '');
  };

  const handleSavePrompt = async () => {
    if (!activeCategory) return;
    setSavingPrompt(true);
    try {
      const result = await api.saveCategoryPrompt(activeCategory, promptDraft);
      setPrompts((prev) => {
        const idx = prev.findIndex((p) => p.category === activeCategory);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = result;
          return next;
        }
        return [...prev, result];
      });
      setSavedPrompt(true);
      setTimeout(() => setSavedPrompt(false), 2000);
    } catch (err) {
      console.error('Failed to save prompt:', err);
      alert('Failed to save prompt. Please try again.');
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleAddCategory = () => {
    const cat = newCategory.trim();
    if (!cat) return;
    setNewCategory('');
    setShowNewCategory(false);
    selectCategory(cat);
  };

  const handleDeletePrompt = async (category: string) => {
    try {
      await api.deleteCategoryPrompt(category);
      setPrompts((prev) => prev.filter((p) => p.category !== category));
      if (activeCategory === category) {
        setActiveCategory(null);
        setPromptDraft('');
      }
    } catch (err) {
      console.error('Failed to delete prompt:', err);
    }
  };

  // ── Categories that have prompts + those that don't ────

  const promptCategories = prompts.map((p) => p.category);
  const uncoveredCategories = categories.filter((c) => !promptCategories.includes(c));

  // ── Tabs ──────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; icon: typeof Building2 }[] = [
    { key: 'prompts', label: 'Category Prompts', icon: MessageSquareText },
    { key: 'company', label: 'Company Profile', icon: Building2 },
    { key: 'email', label: 'Email Preferences', icon: Mail },
    { key: 'signature', label: 'Email Signature', icon: Pen },
  ];

  // ── Render ────────────────────────────────────────────────

  if (loadingSettings) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-ink-dim" />
      </div>
    );
  }

  return (
    <div className="p-10 max-w-[1000px] mx-auto min-h-full bg-cream">
      <div className="mb-8">
        <EyebrowLabel variant="pill" className="mb-4">
          WORKSPACE · SETTINGS
        </EyebrowLabel>
        <SectionHeading size="section">Settings.</SectionHeading>
        <p className="text-ink-muted text-sm mt-3">
          Configure your category prompts, company profile, and email preferences.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-8 bg-paper border border-hair-soft rounded-lg p-1 w-fit">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                tab === t.key
                  ? 'bg-[rgba(10,156,212,0.15)] text-sky-ink'
                  : 'text-ink-dim hover:text-ink-muted'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Category Prompts tab ──────────────────────────── */}
      {tab === 'prompts' && (
        <div className="flex gap-6">
          {/* Category list */}
          <div className="w-[220px] flex-shrink-0">
            <div className="bg-paper border border-hair-soft rounded-xl p-4">
              <h3 className="text-ink-dim text-xs font-medium uppercase tracking-wider mb-3">
                Categories
              </h3>

              {loadingPrompts ? (
                <Loader2 size={16} className="animate-spin text-ink-dim mx-auto" />
              ) : (
                <div className="space-y-1">
                  {/* Categories with prompts */}
                  {promptCategories.map((cat) => (
                    <div key={cat} className="flex items-center gap-1">
                      <button
                        onClick={() => selectCategory(cat)}
                        className={`flex-1 text-left px-3 py-2 rounded-lg text-sm transition-all ${
                          activeCategory === cat
                            ? 'bg-[rgba(10,156,212,0.15)] text-sky-ink'
                            : 'text-ink-muted hover:bg-[rgba(11,13,14,0.03)] hover:text-ink'
                        }`}
                      >
                        {cat}
                      </button>
                      <button
                        onClick={() => handleDeletePrompt(cat)}
                        className="text-ink-dim hover:text-red-400 p-1 rounded transition-all"
                        title="Delete prompt"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}

                  {/* Categories without prompts */}
                  {uncoveredCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => selectCategory(cat)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                        activeCategory === cat
                          ? 'bg-[rgba(10,156,212,0.15)] text-sky-ink'
                          : 'text-ink-dim hover:bg-[rgba(11,13,14,0.03)] hover:text-ink-muted'
                      }`}
                    >
                      {cat}
                      <span className="text-[10px] ml-1.5 opacity-60">new</span>
                    </button>
                  ))}

                  {/* Add custom category */}
                  {showNewCategory ? (
                    <div className="flex items-center gap-1 mt-2">
                      <input
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddCategory();
                          if (e.key === 'Escape') setShowNewCategory(false);
                        }}
                        placeholder="Category name"
                        autoFocus
                        className="flex-1 bg-tray border border-hair-soft rounded px-2 py-1.5 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)]"
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowNewCategory(true)}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-ink-dim hover:text-ink-muted transition-all flex items-center gap-1.5 mt-1"
                    >
                      <Plus size={12} />
                      Add category
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Prompt editor */}
          <div className="flex-1">
            {activeCategory ? (
              <div className="bg-paper border border-hair-soft rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-ink text-lg font-bold">{activeCategory}</h2>
                  <button
                    onClick={handleSavePrompt}
                    disabled={savingPrompt}
                    className="bg-ink text-white font-bold rounded-lg px-5 py-2 text-sm hover:bg-ink/90 transition-all disabled:opacity-40 flex items-center gap-2"
                  >
                    {savingPrompt ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : savedPrompt ? (
                      <Check size={14} />
                    ) : (
                      <Save size={14} />
                    )}
                    {savedPrompt ? 'Saved' : 'Save'}
                  </button>
                </div>

                <div>
                  <label className="text-ink-muted text-sm font-medium block mb-2">
                    AI Prompt
                  </label>
                  <p className="text-ink-dim text-xs mb-3">
                    Write context about this industry for the AI. When drafting emails for leads in this category, the AI will combine your prompt with the call transcript to write relevant, specific emails. Just write naturally — dot points, sentences, whatever works.
                  </p>
                  <textarea
                    value={promptDraft}
                    onChange={(e) => { setPromptDraft(e.target.value); setSavedPrompt(false); }}
                    placeholder={"e.g. Property styling businesses deal with tight turnarounds between listings. They often have 5-10 jobs running at once and rely on manual scheduling. We can automate their booking pipeline, auto-generate styled room mockups with AI, and build dashboards that show job status across all active listings. We've helped similar businesses cut admin time by 60%."}
                    rows={12}
                    className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-3 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all resize-none leading-relaxed"
                  />
                </div>
              </div>
            ) : (
              <div className="bg-paper border border-hair-soft rounded-xl p-12 text-center">
                <MessageSquareText size={32} className="text-ink-dim mx-auto mb-3" />
                <p className="text-ink-muted text-sm mb-1">Select a category to write its prompt</p>
                <p className="text-ink-dim text-xs">
                  The AI combines your prompt with the call transcript to write industry-specific emails. One prompt per category — keep it simple.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Company Profile tab ────────────────────────────── */}
      {tab === 'company' && (
        <div className="bg-paper border border-hair-soft rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-ink text-lg font-bold">Company Profile</h2>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="bg-ink text-white font-bold rounded-lg px-5 py-2 text-sm hover:bg-ink/90 transition-all disabled:opacity-40 flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>

          <div className="space-y-5">
            <SettingsField
              label="Company Name"
              value={settings.company_name || ''}
              onChange={(v) => updateSetting('company_name', v)}
            />
            <div>
              <label className="text-ink-muted text-sm font-medium block mb-2">Company Description</label>
              <p className="text-ink-dim text-xs mb-2">What does OxyScale do? This is used in email drafts when introducing the company.</p>
              <textarea
                value={settings.company_description || ''}
                onChange={(e) => updateSetting('company_description', e.target.value)}
                rows={3}
                className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-3 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all resize-none leading-relaxed"
              />
            </div>
            <SettingsField
              label="Your Name"
              value={settings.sender_name || ''}
              onChange={(v) => updateSetting('sender_name', v)}
            />
            <SettingsField
              label="Phone Number"
              value={settings.sender_phone || ''}
              onChange={(v) => updateSetting('sender_phone', v)}
            />
            <SettingsField
              label="Calendly Link"
              value={settings.calendly_link || ''}
              onChange={(v) => updateSetting('calendly_link', v)}
              description="Used in voicemail follow-up emails and booking invites."
            />
            <SettingsField
              label="Calendly Call Duration (minutes)"
              value={settings.calendly_duration || ''}
              onChange={(v) => updateSetting('calendly_duration', v)}
              description="How long is the discovery call? Used in email wording."
            />
          </div>
        </div>
      )}

      {/* ── Email Preferences tab ──────────────────────────── */}
      {tab === 'email' && (
        <div className="bg-paper border border-hair-soft rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-ink text-lg font-bold">Email Preferences</h2>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="bg-ink text-white font-bold rounded-lg px-5 py-2 text-sm hover:bg-ink/90 transition-all disabled:opacity-40 flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>

          <div className="space-y-5">
            <SettingsField
              label="Sign-off Style"
              value={settings.email_sign_off || ''}
              onChange={(v) => updateSetting('email_sign_off', v)}
              description="How you close emails. e.g. 'Cheers', 'Kind regards', 'Talk soon'"
            />
            <div>
              <label className="text-ink-muted text-sm font-medium block mb-2">Phrases to Avoid</label>
              <p className="text-ink-dim text-xs mb-2">Words or phrases the AI should never use in emails. One per line.</p>
              <textarea
                value={settings.email_avoid_phrases || ''}
                onChange={(e) => updateSetting('email_avoid_phrases', e.target.value)}
                placeholder={"leverage\nsynergy\nstreamline\nI hope this finds you well"}
                rows={4}
                className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-3 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all resize-none leading-relaxed"
              />
            </div>
            <div>
              <label className="text-ink-muted text-sm font-medium block mb-2">Additional Email Instructions</label>
              <p className="text-ink-dim text-xs mb-2">Any other rules for how the AI should write emails. e.g. "Always mention we're based in Melbourne"</p>
              <textarea
                value={settings.email_extra_instructions || ''}
                onChange={(e) => updateSetting('email_extra_instructions', e.target.value)}
                rows={3}
                className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-3 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all resize-none leading-relaxed"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Email Signature tab ──────────────────────────────── */}
      {tab === 'signature' && (
        <div className="space-y-6">
          <div className="bg-paper border border-hair-soft rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-ink text-lg font-bold">Email Signature</h2>
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="bg-ink text-white font-bold rounded-lg px-5 py-2 text-sm hover:bg-ink/90 transition-all disabled:opacity-40 flex items-center gap-2"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
                {saved ? 'Saved' : 'Save'}
              </button>
            </div>

            <div className="space-y-5">
              <SettingsField
                label="Title / Role"
                value={settings.sender_title || ''}
                onChange={(v) => updateSetting('sender_title', v)}
                description="Your job title shown in the email signature. e.g. 'Co-Founder', 'Head of Sales'"
              />
              <SettingsField
                label="Website URL"
                value={settings.website_url || ''}
                onChange={(v) => updateSetting('website_url', v)}
                description="Company website shown in the signature."
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="bg-paper border border-hair-soft rounded-xl p-6">
            <h3 className="text-ink-muted text-sm font-medium mb-4">Signature Preview</h3>
            <div className="bg-cream rounded-lg p-6">
              <SignaturePreview
                senderName={settings.sender_name || 'Jordan Bell'}
                senderTitle={settings.sender_title || 'Co-Founder'}
                senderPhone={settings.sender_phone || '0478 197 600'}
                websiteUrl={settings.website_url || 'https://oxyscale.ai'}
                calendlyLink={settings.calendly_link || 'https://calendly.com/jordan-oxyscale/30min'}
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Signature preview component ────────────────────────────

function SignaturePreview({
  senderName,
  senderTitle,
  senderPhone,
  websiteUrl,
  calendlyLink,
}: {
  senderName: string;
  senderTitle: string;
  senderPhone: string;
  websiteUrl: string;
  calendlyLink: string;
}) {
  const cleanUrl = websiteUrl.replace(/^https?:\/\//, '');

  const signatureHtml = `
    <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%;">
      <tr>
        <td style="padding: 0 0 16px 0;">
          <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%;">
            <tr>
              <td style="width: 60px; height: 2px; background-color: #0a9cd4; font-size: 0; line-height: 0;"></td>
              <td style="height: 2px; font-size: 0; line-height: 0;"></td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding: 0 0 2px 0;">
          <span style="color: #0b0d0e; font-size: 14px; font-weight: 600; font-family: Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">${senderName}</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 0 0 10px 0;">
          <span style="color: #8a95a0; font-size: 12px; font-family: Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">${senderTitle}</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 0 0 8px 0;">
          <a href="${websiteUrl}" style="text-decoration: none; font-family: Geist, -apple-system, sans-serif; font-weight: 600; font-size: 15px; letter-spacing: -0.035em;">
            <span style="color: #0b0d0e;">Oxy</span><span style="color: #0a9cd4;">Scale</span>
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding: 0 0 4px 0;">
          <span style="color: #8a95a0; font-size: 12px; font-family: Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">${senderPhone}</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 0 0 12px 0;">
          <a href="${websiteUrl}" style="color: #0a9cd4; font-size: 12px; text-decoration: none; font-weight: 500; font-family: Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">${cleanUrl}</a>
        </td>
      </tr>
      <tr>
        <td style="padding: 0;">
          <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
            <tr>
              <td style="background-color: #0b0d0e; border-radius: 999px; padding: 8px 18px;">
                <a href="${calendlyLink}" style="color: #ffffff; font-size: 12px; font-weight: 600; text-decoration: none; display: block; font-family: Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">Book a call</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return (
    <div dangerouslySetInnerHTML={{ __html: signatureHtml }} />
  );
}

// ── Reusable field component ────────────────────────────────

function SettingsField({
  label,
  value,
  onChange,
  description,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  description?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-ink-muted text-sm font-medium block mb-1.5">{label}</label>
      {description && <p className="text-ink-dim text-xs mb-2">{description}</p>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
      />
    </div>
  );
}
