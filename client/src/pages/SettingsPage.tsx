import { useState, useEffect, useRef } from 'react';
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
  Lock,
  Wrench,
  AlertTriangle,
  Tag,
} from 'lucide-react';
import * as api from '../services/api';
import { useAuth } from '../hooks/useAuth';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';

// ── Types ───────────────────────────────────────────────────

type Tab = 'categories' | 'prompts' | 'company' | 'email' | 'signature' | 'cleanup' | 'account';

// ── Main Component ──────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('categories');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Category prompts
  const [prompts, setPrompts] = useState<api.CategoryPrompt[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [ctaDocUrl, setCtaDocUrl] = useState('');
  const [ctaDocLabel, setCtaDocLabel] = useState('');
  const [ctaIntro, setCtaIntro] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedPrompt, setSavedPrompt] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);

  // Available categories from leads
  const [categories, setCategories] = useState<string[]>([]);

  // Managed categories (Settings > Categories tab)
  const [managedCategories, setManagedCategories] = useState<api.Category[]>([]);
  const [loadingManagedCats, setLoadingManagedCats] = useState(true);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  // ── Load data ─────────────────────────────────────────────

  useEffect(() => {
    loadSettings();
    loadPrompts();
    loadCategories();
    loadManagedCategories();
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

  const loadManagedCategories = async () => {
    setLoadingManagedCats(true);
    try {
      const cats = await api.getManagedCategories();
      setManagedCategories(cats);
    } catch {
      // Non-critical
    } finally {
      setLoadingManagedCats(false);
    }
  };

  const handleAddManagedCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setAddingCategory(true);
    setCategoryError(null);
    try {
      const cat = await api.createCategory(name);
      setManagedCategories((prev) => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCategoryName('');
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : 'Failed to add category');
    } finally {
      setAddingCategory(false);
    }
  };

  // Track which category is mid-confirmation so we can render the modal.
  const [deletingCategory, setDeletingCategory] = useState<api.Category | null>(null);

  const handleDeleteManagedCategory = (cat: api.Category) => {
    // Always go through the modal so the lead count + the "also delete
    // leads" option are visible before any destructive action runs.
    setDeletingCategory(cat);
  };

  const confirmDeleteCategory = async (cat: api.Category, deleteLeads: boolean) => {
    try {
      await api.deleteCategory(cat.id, { deleteLeads });
      setManagedCategories((prev) => prev.filter((c) => c.id !== cat.id));
      setDeletingCategory(null);
      // If leads were deleted, refresh the available-categories cache so
      // other downstream tabs (Cleanup section, etc.) see the new state.
      if (deleteLeads) loadCategories();
    } catch (err) {
      console.error('Failed to delete category:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete category');
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
    setCtaDocUrl(existing?.cta_doc_url || '');
    setCtaDocLabel(existing?.cta_doc_label || '');
    setCtaIntro(existing?.cta_intro || '');
  };

  const handleSavePrompt = async () => {
    if (!activeCategory) return;
    setSavingPrompt(true);
    try {
      const result = await api.saveCategoryPrompt(activeCategory, {
        prompt: promptDraft,
        ctaDocUrl: ctaDocUrl,
        ctaDocLabel: ctaDocLabel,
        ctaIntro: ctaIntro,
      });
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
    { key: 'categories', label: 'Categories', icon: Tag },
    { key: 'prompts', label: 'Category Prompts', icon: MessageSquareText },
    { key: 'company', label: 'Company Profile', icon: Building2 },
    { key: 'email', label: 'Email Preferences', icon: Mail },
    { key: 'signature', label: 'Email Signature', icon: Pen },
    { key: 'cleanup', label: 'Lead Cleanup', icon: Wrench },
    { key: 'account', label: 'Account', icon: Lock },
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

      {/* ── Categories tab ─────────────────────────────────── */}
      {tab === 'categories' && (
        <div className="bg-paper border border-hair-soft rounded-xl p-6">
          <h3 className="text-ink font-medium text-base mb-1">Manage categories</h3>
          <p className="text-ink-muted text-sm mb-5">
            These appear as dropdown options when creating or editing a lead. Add new industries here as you expand.
          </p>

          {/* Add category */}
          <div className="flex items-center gap-3 mb-5">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => { setNewCategoryName(e.target.value); setCategoryError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddManagedCategory(); }}
              placeholder="New category name"
              maxLength={80}
              className="flex-1 bg-cream border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
            />
            <button
              onClick={handleAddManagedCategory}
              disabled={!newCategoryName.trim() || addingCategory}
              className="bg-ink text-white text-sm font-medium rounded-full px-5 py-2.5 hover:bg-[#1a1d1f] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {addingCategory ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add category
            </button>
          </div>

          {categoryError && (
            <div className="mb-4 bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.22)] rounded-lg px-4 py-2.5 text-red-500 text-sm">
              {categoryError}
            </div>
          )}

          {/* Category list */}
          {loadingManagedCats ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-ink-dim" />
            </div>
          ) : managedCategories.length === 0 ? (
            <p className="text-ink-dim text-sm italic py-4">No categories yet. Add one above.</p>
          ) : (
            <div className="space-y-2">
              {managedCategories.map((cat) => (
                <div
                  key={cat.id}
                  className="flex items-center justify-between bg-cream border border-hair-soft rounded-lg px-4 py-3 group"
                >
                  <span className="text-ink text-sm font-medium">
                    {cat.name}
                    {typeof cat.lead_count === 'number' && cat.lead_count > 0 && (
                      <span className="text-ink-dim text-xs font-normal ml-2">
                        · {cat.lead_count} lead{cat.lead_count === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => handleDeleteManagedCategory(cat)}
                    className="text-ink-dim hover:text-risk transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete category"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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

                {/* Capabilities CTA — populated for industries that have a hosted capabilities doc */}
                <div className="mt-6 border-t border-hair-soft pt-5">
                  <div className="mb-3">
                    <label className="text-ink-muted text-sm font-medium block">
                      Capabilities document CTA <span className="text-ink-dim font-normal">(optional)</span>
                    </label>
                    <p className="text-ink-dim text-xs mt-1.5 leading-relaxed">
                      When configured, leads in this category get a "Include capabilities document" toggle in the Email Bank that drops a blue button into the email linking to this URL. Leave blank to keep the toggle hidden.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-ink-dim text-xs font-medium block mb-1.5 uppercase tracking-wider">
                        URL
                      </label>
                      <input
                        type="url"
                        value={ctaDocUrl}
                        onChange={(e) => { setCtaDocUrl(e.target.value); setSavedPrompt(false); }}
                        placeholder="https://manufacturing.oxyscale.ai"
                        className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
                      />
                    </div>

                    <div>
                      <label className="text-ink-dim text-xs font-medium block mb-1.5 uppercase tracking-wider">
                        Button label
                      </label>
                      <input
                        type="text"
                        value={ctaDocLabel}
                        onChange={(e) => { setCtaDocLabel(e.target.value); setSavedPrompt(false); }}
                        placeholder="View capabilities document"
                        className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
                      />
                    </div>

                    <div>
                      <label className="text-ink-dim text-xs font-medium block mb-1.5 uppercase tracking-wider">
                        Intro line
                      </label>
                      <textarea
                        value={ctaIntro}
                        onChange={(e) => { setCtaIntro(e.target.value); setSavedPrompt(false); }}
                        placeholder="A deeper look at how we work with manufacturers and the operating system we'd build for you."
                        rows={2}
                        className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all resize-none leading-relaxed"
                      />
                    </div>
                  </div>
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
              label='"Book a call" button URL'
              value={settings.book_a_call_url || ''}
              onChange={(v) => updateSetting('book_a_call_url', v)}
              description="Campaign-wide Calendly link the black 'Book a call' button drops into emails. Same link goes out regardless of which user sends."
            />
            <SettingsField
              label='Recruitment hook document URL'
              value={settings.capabilities_default_url || ''}
              onChange={(v) => updateSetting('capabilities_default_url', v)}
              description="Recruitment-specific landing page (default: info.oxyscale.ai). Used by the 'Recruitment hook' toggle in the Email Bank. Per-category overrides take priority."
            />
            <SettingsField
              label='Recruitment hook button label'
              value={settings.capabilities_default_label || ''}
              onChange={(v) => updateSetting('capabilities_default_label', v)}
              description="Text on the blue button. Default: 'View our capabilities'."
            />
            <SettingsField
              label='Capabilities document URL'
              value={settings.capabilities_secondary_url || ''}
              onChange={(v) => updateSetting('capabilities_secondary_url', v)}
              description="Broad / non-recruitment capabilities page (default: details.oxyscale.ai). Used by the 'Capabilities document' toggle in the Email Bank."
            />
            <SettingsField
              label='Capabilities document button label'
              value={settings.capabilities_secondary_label || ''}
              onChange={(v) => updateSetting('capabilities_secondary_label', v)}
              description="Text on the blue button. Default: 'View our capabilities'."
            />
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

      {tab === 'cleanup' && <CleanupSection onChanged={loadCategories} />}

      {tab === 'account' && <AccountSection />}

      {/* Delete-category confirmation modal. Renders over the page when
          deletingCategory is set, showing the lead count and the two
          destructive options. Property Styling cleanup runs through this. */}
      {deletingCategory && (
        <DeleteCategoryModal
          category={deletingCategory}
          onConfirm={(deleteLeads) => confirmDeleteCategory(deletingCategory, deleteLeads)}
          onCancel={() => setDeletingCategory(null)}
        />
      )}

    </div>
  );
}

// ── Delete category confirmation modal ─────────────────────────────
//
// Shown when the user clicks the trash icon next to a managed category.
// If the category has leads attached, offers two destructive paths:
//   - Delete category only — leads keep the string but lose the dropdown
//   - Delete category AND every lead carrying it (cascades through FK)
// If there are no leads, the second option is hidden.

function DeleteCategoryModal({
  category,
  onConfirm,
  onCancel,
}: {
  category: api.Category;
  onConfirm: (deleteLeads: boolean) => void;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const leadCount = category.lead_count ?? 0;

  const handle = async (deleteLeads: boolean) => {
    if (deleteLeads && leadCount > 0) {
      // Double-confirm for the cascade-delete path since it nukes everything
      // attached to the lead (call logs, notes, tasks, emails, activities).
      const ok = window.confirm(
        `Permanently delete the category "${category.name}" AND all ${leadCount} lead${leadCount === 1 ? '' : 's'} that carry it?\n\n` +
        `Every call log, note, task, email and activity attached to those leads will go with them. This cannot be undone.`,
      );
      if (!ok) return;
    }
    setSubmitting(true);
    onConfirm(deleteLeads);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6" onClick={onCancel}>
      <div
        className="bg-paper border border-hair-soft rounded-2xl shadow-xl p-7 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="bg-[rgba(239,68,68,0.1)] rounded-full p-2 flex-shrink-0 mt-0.5">
            <AlertTriangle size={18} className="text-risk" />
          </div>
          <div>
            <h2 className="text-ink text-lg font-medium tracking-tight">Delete "{category.name}"?</h2>
            {leadCount > 0 ? (
              <p className="text-ink-muted text-sm mt-1.5">
                {leadCount} lead{leadCount === 1 ? '' : 's'} currently carry this category.
                Choose what to do with them below.
              </p>
            ) : (
              <p className="text-ink-muted text-sm mt-1.5">
                No leads currently use this category — safe to delete.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2 mt-5">
          {leadCount > 0 && (
            <button
              onClick={() => handle(false)}
              disabled={submitting}
              className="w-full text-left border border-hair-soft rounded-lg px-4 py-3 hover:bg-tray transition-all disabled:opacity-40"
            >
              <div className="text-ink text-sm font-medium">Delete category only</div>
              <div className="text-ink-dim text-xs mt-0.5">
                The {leadCount} lead{leadCount === 1 ? '' : 's'} stay, but their category string remains as-is.
              </div>
            </button>
          )}
          <button
            onClick={() => handle(true)}
            disabled={submitting}
            className="w-full text-left border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.04)] rounded-lg px-4 py-3 hover:bg-[rgba(239,68,68,0.08)] transition-all disabled:opacity-40"
          >
            <div className="text-risk text-sm font-medium">
              {leadCount > 0
                ? `Delete category AND all ${leadCount} lead${leadCount === 1 ? '' : 's'}`
                : 'Delete category'}
            </div>
            {leadCount > 0 && (
              <div className="text-ink-dim text-xs mt-0.5">
                Cascades through call logs, notes, tasks, emails, activities. Irreversible.
              </div>
            )}
          </button>
        </div>

        <div className="flex justify-end mt-5">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="text-ink-muted text-sm hover:text-ink transition-colors px-4 py-2 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cleanup section — merge categories + dedupe leads ──────────────

function CleanupSection({ onChanged }: { onChanged: () => void }) {
  const [renameFrom, setRenameFrom] = useState('Styling');
  const [renameTo, setRenameTo] = useState('Property Styling');
  const [renaming, setRenaming] = useState(false);
  const [renameResult, setRenameResult] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Clear pipeline (set pipeline_stage = NULL so the kanban is empty)
  const [preserveWonLost, setPreserveWonLost] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  // Undo-a-CSV-import — upload the original file, preview matching leads
  // by phone number, then confirm to delete the batch.
  const [undoFile, setUndoFile] = useState<File | null>(null);
  const [undoPreviewing, setUndoPreviewing] = useState(false);
  const [undoDeleting, setUndoDeleting] = useState(false);
  const [undoPreview, setUndoPreview] = useState<api.UndoImportResult | null>(null);
  const [undoResult, setUndoResult] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const undoFileInputRef = useRef<HTMLInputElement>(null);

  const handleRename = async () => {
    if (!renameFrom.trim() || !renameTo.trim()) return;
    setRenaming(true);
    setRenameError(null);
    setRenameResult(null);
    try {
      const r = await api.renameCategory(renameFrom.trim(), renameTo.trim());
      setRenameResult(`Moved ${r.updated} lead${r.updated === 1 ? '' : 's'} from "${r.from}" to "${r.to}".`);
      onChanged();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setRenaming(false);
    }
  };

  const handleResetPipeline = async () => {
    const confirmMsg = preserveWonLost
      ? 'Remove every Tier 1 / Tier 2 / Tier 3 lead from the pipeline?\n\nThe kanban will be empty (Won and Lost stay where they are). Leads still exist in the Leads page — you just place them back into tiers manually when you decide where they belong.\n\nThis is reversible — just edit each lead.'
      : 'Remove EVERY lead (including Won and Lost) from the pipeline?\n\nThe entire kanban will be empty. Leads still exist in the Leads page. This is reversible but will wipe historical Won/Lost positioning.';
    if (!window.confirm(confirmMsg)) return;
    setResetting(true);
    setResetError(null);
    setResetResult(null);
    try {
      const r = await api.resetPipeline(preserveWonLost);
      setResetResult(
        r.updated === 0
          ? 'Pipeline was already empty.'
          : `Removed ${r.updated} lead${r.updated === 1 ? '' : 's'} from the pipeline. Open Pipeline to confirm it's clear, then place them back into tiers from the Leads page.`
      );
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  const handleUndoFileSelect = (file: File | null) => {
    setUndoFile(file);
    setUndoPreview(null);
    setUndoResult(null);
    setUndoError(null);
  };

  const handleUndoPreview = async () => {
    if (!undoFile) return;
    setUndoPreviewing(true);
    setUndoError(null);
    setUndoResult(null);
    try {
      const r = await api.undoImport(undoFile, true);
      setUndoPreview(r);
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setUndoPreviewing(false);
    }
  };

  const handleUndoConfirm = async () => {
    if (!undoFile || !undoPreview || undoPreview.toDelete === 0) return;
    const protectedNote = undoPreview.protected > 0
      ? `\n\n${undoPreview.protected} lead${undoPreview.protected === 1 ? '' : 's'} matched but are PROTECTED (have notes/tasks/calls/emails or are in a tier) — those will NOT be touched.`
      : '';
    const ok = window.confirm(
      `Permanently delete ${undoPreview.toDelete} lead${undoPreview.toDelete === 1 ? '' : 's'}?` +
      protectedNote +
      `\n\nEvery call log, note, task, email and activity on the deleted leads will go with them. This cannot be undone.`,
    );
    if (!ok) return;
    setUndoDeleting(true);
    setUndoError(null);
    try {
      const r = await api.undoImport(undoFile, false);
      const protectedNote = r.protected > 0
        ? ` ${r.protected} kept (had business activity attached).`
        : '';
      setUndoResult(
        `Deleted ${r.deleted} lead${r.deleted === 1 ? '' : 's'} (out of ${r.csvRows} CSV rows).${protectedNote} Hard refresh the Leads page to confirm.`,
      );
      setUndoPreview(null);
      setUndoFile(null);
      if (undoFileInputRef.current) undoFileInputRef.current.value = '';
      onChanged();
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setUndoDeleting(false);
    }
  };


  return (
    <div className="space-y-6">
      {/* Clear pipeline */}
      <div className="bg-paper border border-hair-soft rounded-xl p-6">
        <h3 className="text-ink font-medium text-base mb-1">Clear the pipeline</h3>
        <p className="text-ink-muted text-sm mb-4">
          Remove every active lead from the kanban so it's empty. Leads stay in the <span className="text-ink font-medium">Leads</span> page — you place them back into tiers manually from the lead profile.
        </p>

        <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={preserveWonLost}
            onChange={(e) => setPreserveWonLost(e.target.checked)}
            className="w-4 h-4 accent-sky-ink"
          />
          <span className="text-ink-muted text-sm">
            Keep Won and Lost where they are (recommended)
          </span>
        </label>

        <button
          onClick={handleResetPipeline}
          disabled={resetting}
          className="bg-ink text-white text-sm font-medium rounded-full px-5 py-2 hover:bg-[#1a1d1f] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {resetting ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
          {resetting ? 'Clearing...' : 'Clear pipeline'}
        </button>

        {resetResult && (
          <div className="mt-4 bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.25)] rounded-lg p-3">
            <p className="text-ok text-sm flex items-center gap-2"><Check size={14} />{resetResult}</p>
          </div>
        )}
        {resetError && (
          <div className="mt-4 bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] rounded-lg p-3">
            <p className="text-risk text-sm">{resetError}</p>
          </div>
        )}
      </div>

      {/* Undo a CSV import */}
      <div className="bg-paper border border-hair-soft rounded-xl p-6">
        <h3 className="text-ink font-medium text-base mb-1">Undo a CSV import</h3>
        <p className="text-ink-muted text-sm mb-4">
          Regret an import? Re-upload the same CSV. We'll match leads by phone number (last 9 digits, so +61 vs 0 vs no-prefix variants all collapse) and delete the matching batch — call logs, notes, tasks, emails all go with them. Two steps: preview the count first, then confirm.
        </p>

        <div className="flex items-center gap-3 mb-4">
          <input
            ref={undoFileInputRef}
            type="file"
            accept=".csv"
            onChange={(e) => handleUndoFileSelect(e.target.files?.[0] || null)}
            className="block text-sm text-ink-muted file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-medium file:bg-tray file:text-ink hover:file:bg-[rgba(11,13,14,0.06)] file:cursor-pointer"
          />
          {undoFile && (
            <button
              onClick={() => handleUndoFileSelect(null)}
              className="text-ink-dim hover:text-risk text-sm"
              title="Clear selection"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleUndoPreview}
            disabled={!undoFile || undoPreviewing || undoDeleting}
            className="border border-hair-strong text-ink text-sm font-medium rounded-full px-5 py-2 hover:bg-[rgba(11,13,14,0.03)] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {undoPreviewing ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
            {undoPreviewing ? 'Scanning...' : 'Preview matches'}
          </button>

          {undoPreview && undoPreview.toDelete > 0 && (
            <button
              onClick={handleUndoConfirm}
              disabled={undoDeleting}
              className="bg-risk text-white text-sm font-medium rounded-full px-5 py-2 hover:bg-red-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {undoDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {undoDeleting ? 'Deleting...' : `Delete ${undoPreview.toDelete} lead${undoPreview.toDelete === 1 ? '' : 's'}`}
            </button>
          )}
        </div>

        {undoPreview && (
          <div className="mt-4 space-y-3">
            {undoPreview.matched === 0 ? (
              <div className="bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.25)] rounded-lg p-3">
                <p className="text-warn text-sm flex items-center gap-2">
                  <AlertTriangle size={14} />
                  Found {undoPreview.csvPhonesFound} phone number{undoPreview.csvPhonesFound === 1 ? '' : 's'} in the CSV but no leads matched. The batch may have already been deleted, or these phones don't exist in your leads.
                </p>
              </div>
            ) : (
              <>
                {/* Summary line — what would happen */}
                <div className="bg-cream border border-hair-soft rounded-lg p-3">
                  <p className="text-ink text-sm font-medium mb-1">
                    {undoPreview.matched} of {undoPreview.csvRows} CSV row{undoPreview.csvRows === 1 ? '' : 's'} matched leads in your DB.
                  </p>
                  <ul className="text-ink-muted text-sm space-y-0.5 mt-1.5">
                    <li className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-risk flex-shrink-0" />
                      <span><span className="font-medium text-ink">{undoPreview.toDelete}</span> will be deleted (untouched scrape rows)</span>
                    </li>
                    {undoPreview.protected > 0 && (
                      <li className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-ok flex-shrink-0" />
                        <span><span className="font-medium text-ink">{undoPreview.protected}</span> protected — kept because you've worked them (notes, tasks, calls, emails, deal value, or placed in a tier)</span>
                      </li>
                    )}
                  </ul>
                </div>

                {/* Sample of what WILL be deleted */}
                {undoPreview.sample.length > 0 && (
                  <div className="bg-cream border border-hair-soft rounded-lg p-3">
                    <p className="text-ink-dim text-[11px] uppercase tracking-wider font-medium mb-1.5">
                      To be deleted · sample (first {undoPreview.sample.length})
                    </p>
                    <div className="max-h-40 overflow-y-auto">
                      {undoPreview.sample.map((s) => (
                        <div key={s.id} className="text-ink-muted text-xs py-1 border-b border-hair-soft last:border-b-0 flex items-center justify-between gap-3">
                          <span className="truncate">{s.name}</span>
                          <span className="text-ink-dim flex-shrink-0">{s.phone}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sample of what's PROTECTED — so Jordan can sanity-check */}
                {undoPreview.protectedSample.length > 0 && (
                  <div className="bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.2)] rounded-lg p-3">
                    <p className="text-ok text-[11px] uppercase tracking-wider font-medium mb-1.5">
                      Will be kept · sample (first {undoPreview.protectedSample.length})
                    </p>
                    <div className="max-h-40 overflow-y-auto">
                      {undoPreview.protectedSample.map((s) => (
                        <div key={s.id} className="text-ink-muted text-xs py-1 border-b border-[rgba(16,185,129,0.15)] last:border-b-0 flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-ink">{s.name}</div>
                            {s.reason && <div className="text-ink-dim text-[11px]">{s.reason}</div>}
                          </div>
                          <span className="text-ink-dim flex-shrink-0">{s.phone}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {undoResult && (
          <div className="mt-4 bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.25)] rounded-lg p-3">
            <p className="text-ok text-sm flex items-center gap-2"><Check size={14} />{undoResult}</p>
          </div>
        )}
        {undoError && (
          <div className="mt-4 bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] rounded-lg p-3">
            <p className="text-risk text-sm">{undoError}</p>
          </div>
        )}
      </div>

      {/* Merge categories */}
      <div className="bg-paper border border-hair-soft rounded-xl p-6">
        <h3 className="text-ink font-medium text-base mb-1">Merge a category</h3>
        <p className="text-ink-muted text-sm mb-4">
          Move every lead from one category into another. The "from" category will disappear from the dialler tabs once empty.
        </p>

        <div className="grid grid-cols-2 gap-3 max-w-xl">
          <div>
            <label className="text-ink-dim text-xs font-medium uppercase tracking-wider block mb-1.5">From</label>
            <input
              type="text"
              value={renameFrom}
              onChange={(e) => setRenameFrom(e.target.value)}
              className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-sky transition-all"
            />
          </div>
          <div>
            <label className="text-ink-dim text-xs font-medium uppercase tracking-wider block mb-1.5">Into</label>
            <input
              type="text"
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              className="w-full bg-cream border border-hair-soft rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-sky transition-all"
            />
          </div>
        </div>

        <button
          onClick={handleRename}
          disabled={renaming || !renameFrom.trim() || !renameTo.trim()}
          className="mt-4 bg-ink text-white text-sm font-medium rounded-full px-5 py-2 hover:bg-[#1a1d1f] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {renaming ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
          {renaming ? 'Merging...' : 'Merge category'}
        </button>

        {renameResult && (
          <div className="mt-4 bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.25)] rounded-lg p-3">
            <p className="text-ok text-sm flex items-center gap-2"><Check size={14} />{renameResult}</p>
          </div>
        )}
        {renameError && (
          <div className="mt-4 bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] rounded-lg p-3">
            <p className="text-risk text-sm">{renameError}</p>
          </div>
        )}
      </div>

    </div>
  );
}

// ── Account section — change-password form for the logged-in user ──

function AccountSection() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 10) {
      setError('New password must be at least 10 characters');
      return;
    }
    if (newPassword !== confirm) {
      setError('New passwords do not match');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-paper border border-hair-soft rounded-xl p-8 max-w-[560px]">
      <div className="mb-6">
        <h2 className="text-ink text-lg font-medium tracking-tight mb-1">Signed in as</h2>
        <p className="text-ink-muted text-sm">{user?.name} &middot; {user?.email}</p>
      </div>

      <hr className="border-t border-hair-soft mb-6" />

      <h3 className="text-ink text-sm font-semibold tracking-tight mb-4">Change password</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-ink-dim text-xs font-medium block mb-1.5">Current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full bg-paper border border-hair rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="text-ink-dim text-xs font-medium block mb-1.5">New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full bg-paper border border-hair rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="text-ink-dim text-xs font-medium block mb-1.5">Confirm new password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full bg-paper border border-hair rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
            autoComplete="new-password"
          />
        </div>

        {error && (
          <div className="bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.22)] rounded-lg px-3 py-2 text-risk text-xs">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-[rgba(94,197,230,0.08)] border border-sky-hair rounded-lg px-3 py-2 text-sky-ink text-xs">
            Password updated.
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !currentPassword || !newPassword || !confirm}
          className="bg-ink text-white font-medium text-sm rounded-full px-5 py-2.5 hover:bg-[#1a1d1f] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Save new password
        </button>
      </form>
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
