import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PhoneMissed,
  PhoneOff,
  Voicemail,
  ThumbsDown,
  ThumbsUp,
  ChevronDown,
  ChevronUp,
  Calendar,
  Loader2,
  CalendarPlus,
  MapPin,
  Video,
  UserPlus,
  X,
  CheckCircle,
  ExternalLink,
  AlertCircle,
  Flame,
  Thermometer,
  Snowflake,
} from 'lucide-react';
import { useDialler } from '../hooks/useDiallerSession';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import { createCalendarEvent, getGoogleAuthStatus, getCalendarEvents, updateLeadTemperature } from '../services/api';
import type { Disposition } from '../types';

export default function DispositionPage() {
  const navigate = useNavigate();
  const { currentLead, callDuration, transcript, disposeLead } = useDialler();

  const [selectedTemperature, setSelectedTemperature] = useState<'hot' | 'warm' | 'cold' | null>(null);
  const [disposing, setDisposing] = useState<Disposition | null>(null);
  const [preparingEmail, setPreparingEmail] = useState(false);

  const [quickNote, setQuickNote] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  // Book Meeting state
  const [showBookMeeting, setShowBookMeeting] = useState(false);
  const [meetingEmail, setMeetingEmail] = useState(currentLead?.email || '');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [meetingDuration, setMeetingDuration] = useState('30');
  const [meetingType, setMeetingType] = useState<'google_meet' | 'in_person'>('google_meet');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingGuests, setMeetingGuests] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  const [meetingTimezone, setMeetingTimezone] = useState('Australia/Sydney');
  const [bookingMeeting, setBookingMeeting] = useState(false);

  // Calendar events for selected day
  const [dayEvents, setDayEvents] = useState<Array<{ summary: string; startTime: string; endTime: string }>>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Google Calendar auth state
  const [calendarAuthenticated, setCalendarAuthenticated] = useState<boolean | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<{
    htmlLink: string;
    meetLink?: string;
  } | null>(null);

  // Check Google Calendar auth when Book Meeting section is opened
  useEffect(() => {
    if (showBookMeeting && calendarAuthenticated === null) {
      setCheckingAuth(true);
      getGoogleAuthStatus()
        .then(({ authenticated }) => setCalendarAuthenticated(authenticated))
        .catch(() => setCalendarAuthenticated(false))
        .finally(() => setCheckingAuth(false));
    }
  }, [showBookMeeting, calendarAuthenticated]);

  // Fetch calendar events when meeting date changes
  useEffect(() => {
    if (!meetingDate || calendarAuthenticated !== true) {
      setDayEvents([]);
      return;
    }

    setLoadingEvents(true);
    getCalendarEvents(meetingDate, meetingTimezone)
      .then((events) => setDayEvents(events))
      .catch(() => setDayEvents([]))
      .finally(() => setLoadingEvents(false));
  }, [meetingDate, meetingTimezone, calendarAuthenticated]);

  const handleConnectGoogle = async () => {
    try {
      // Navigate directly to the auth endpoint — it redirects to Google OAuth
      const url = '/api/google/auth';
      window.open(url, '_blank');
      // After the user connects, they'll come back — re-check auth status
      // Poll briefly to detect when they've completed the flow
      const pollInterval = setInterval(async () => {
        try {
          const { authenticated } = await getGoogleAuthStatus();
          if (authenticated) {
            setCalendarAuthenticated(true);
            clearInterval(pollInterval);
          }
        } catch {
          // ignore polling errors
        }
      }, 3000);
      // Stop polling after 2 minutes
      setTimeout(() => clearInterval(pollInterval), 120_000);
    } catch (err) {
      setBookingError('Failed to get Google auth URL. Please try again.');
    }
  };

  const handleBookMeeting = async () => {
    setBookingMeeting(true);
    setBookingError(null);
    setBookingSuccess(null);

    try {
      const guestList = meetingGuests
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean);

      const result = await createCalendarEvent({
        summary: `Meeting with ${currentLead?.name || 'Lead'} - OxyScale`,
        description: meetingNotes || undefined,
        date: meetingDate,
        time: meetingTime,
        duration: parseInt(meetingDuration, 10),
        location: meetingType === 'in_person' ? meetingLocation : undefined,
        guests: [meetingEmail, ...guestList].filter(Boolean),
        meetLink: meetingType === 'google_meet',
        timezone: meetingTimezone,
      });

      setBookingSuccess({
        htmlLink: result.htmlLink,
        meetLink: result.meetLink,
      });
    } catch (err) {
      setBookingError(
        err instanceof Error ? err.message : 'Failed to book meeting. Please try again.'
      );
    } finally {
      setBookingMeeting(false);
    }
  };

  // Format duration for display
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  };

  // Handle disposition action
  const handleDispose = async (disposition: Disposition) => {
    setDisposing(disposition);

    try {
      // Update temperature if selected
      if (selectedTemperature && currentLead) {
        await updateLeadTemperature(currentLead.id, selectedTemperature);
      }

      // Append quick note to transcript if provided
      const fullTranscript = quickNote
        ? `${transcript}\n\n[Quick Note]: ${quickNote}`
        : transcript;

      await disposeLead(
        disposition,
        fullTranscript,
        undefined,
        undefined,
        followUpDate || undefined
      );

      // Email Bank flow: Interested + Voicemail dispositions no longer send Jordan
      // to a compose page mid-rhythm. A draft row is created server-side by the
      // disposition handler and filled in post-Whisper. Jordan reviews whenever
      // he wants via the Email Bank sidebar tab.
      navigate('/dialler');
    } catch (err) {
      console.error('Disposition failed:', err);
      setDisposing(null);
      setPreparingEmail(false);
    }
  };

  // If no current lead, redirect back
  if (!currentLead) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-ink-muted mb-4">No call to dispose.</p>
          <button
            onClick={() => navigate('/dialler')}
            className="bg-ink text-white font-bold rounded-lg px-6 py-3 hover:bg-ink/90 transition-all"
          >
            Back to Dialler
          </button>
        </div>
      </div>
    );
  }

  const dispositionButtons: {
    disposition: Disposition;
    label: string;
    icon: typeof PhoneMissed;
    accent: boolean;
  }[] = [
    {
      disposition: 'no_answer',
      label: "Didn't Answer",
      icon: PhoneMissed,
      accent: false,
    },
    {
      disposition: 'voicemail',
      label: 'Left Voicemail',
      icon: Voicemail,
      accent: false,
    },
    {
      disposition: 'not_interested',
      label: 'Not Interested',
      icon: ThumbsDown,
      accent: false,
    },
    {
      disposition: 'interested',
      label: 'Interested',
      icon: ThumbsUp,
      accent: true,
    },
    {
      disposition: 'wrong_number',
      label: 'Wrong Number',
      icon: PhoneOff,
      accent: false,
    },
  ];

  return (
    <div className="p-10 max-w-2xl mx-auto min-h-full bg-cream">
      {/* Call summary header */}
      <div className="mb-8">
        <EyebrowLabel variant="pill" className="mb-4">
          CALL · DISPOSITION
        </EyebrowLabel>
        <h1 className="text-sky-ink text-[34px] font-semibold tracking-section mb-1">
          Call with {currentLead.name}
        </h1>
        <p className="text-ink-muted mb-3">
          {currentLead.company || 'No company'}
        </p>
        <span className="inline-block bg-paper border border-hair-soft text-ink-muted text-sm px-4 py-1.5 rounded-full">
          Duration: {formatDuration(callDuration)}
        </span>
      </div>

      {/* Call Notes */}
      <div className="mb-6">
        <label className="text-ink-dim text-xs font-medium uppercase tracking-wider block mb-2">
          Call Notes
        </label>
        <textarea
          value={quickNote}
          onChange={(e) => setQuickNote(e.target.value)}
          placeholder="Jot down any notes from the call. The full transcript will be generated automatically from the recording."
          rows={4}
          className="w-full bg-paper border border-hair-soft rounded-lg px-4 py-3 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all resize-none leading-relaxed"
        />
        <p className="text-ink-dim text-xs mt-1.5">
          Full transcript will appear on the lead profile once the recording is processed.
        </p>
      </div>

      {/* Preparing email overlay */}
      {preparingEmail && (
        <div className="mb-8 flex items-center justify-center gap-3 bg-paper border border-[rgba(10,156,212,0.3)] rounded-xl p-6">
          <Loader2 size={20} className="animate-spin text-sky-ink" />
          <span className="text-ink text-sm font-medium">
            Generating email draft...
          </span>
        </div>
      )}

      {/* Temperature selector */}
      <div className="mb-6">
        <label className="text-ink-dim text-xs font-medium uppercase tracking-wider block mb-2">
          Lead Temperature
        </label>
        <div className="flex gap-3">
          {([
            { value: 'hot' as const, label: 'Hot', icon: Flame, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
            { value: 'warm' as const, label: 'Warm', icon: Thermometer, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
            { value: 'cold' as const, label: 'Cold', icon: Snowflake, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
          ]).map(({ value, label, icon: Icon, color, bg, border }) => {
            const isActive = selectedTemperature === value;
            return (
              <button
                key={value}
                onClick={() => setSelectedTemperature(isActive ? null : value)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  isActive
                    ? `${bg} ${border} ${color}`
                    : 'bg-paper border-hair-soft text-ink-dim hover:text-ink-muted'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Schedule Follow-Up */}
      <div className="mb-6">
        <label className="text-ink-dim text-xs font-medium uppercase tracking-wider block mb-2">
          Schedule Follow-Up
        </label>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={followUpDate}
            onChange={(e) => setFollowUpDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            className="bg-paper border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all [color-scheme:dark]"
          />
          {followUpDate && (
            <button
              onClick={() => setFollowUpDate('')}
              className="text-ink-dim hover:text-ink-muted transition-colors"
            >
              <X size={16} />
            </button>
          )}
          <span className="text-ink-dim text-xs">
            {followUpDate ? 'Lead will be moved to Follow Up queue' : 'Optional — set a date to follow up'}
          </span>
        </div>
      </div>

      {/* Disposition buttons — 2 on top, 2 in middle, 1 full-width at bottom */}
      <div className="mb-8 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {dispositionButtons.slice(0, 4).map(({ disposition, label, icon: Icon, accent }) => {
            const isLoading = disposing === disposition;
            return (
              <button
                key={disposition}
                onClick={() => handleDispose(disposition)}
                disabled={disposing !== null}
                className={`h-[120px] rounded-xl border flex flex-col items-center justify-center gap-3 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                  accent
                    ? 'bg-ink text-white border-sky-ink hover:bg-ink/90 font-bold'
                    : 'bg-paper text-ink-muted border-hair-soft hover:bg-[rgba(11,13,14,0.03)] hover:text-ink'
                }`}
              >
                {isLoading ? (
                  <Loader2 size={24} className="animate-spin" />
                ) : (
                  <Icon size={24} />
                )}
                <span className="text-sm font-medium">{label}</span>
              </button>
            );
          })}
        </div>
        {/* Wrong Number — full width at bottom */}
        {dispositionButtons.slice(4).map(({ disposition, label, icon: Icon, accent }) => {
          const isLoading = disposing === disposition;
          return (
            <button
              key={disposition}
              onClick={() => handleDispose(disposition)}
              disabled={disposing !== null}
              className={`w-full h-[56px] rounded-xl border flex items-center justify-center gap-3 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                accent
                  ? 'bg-ink text-white border-sky-ink hover:bg-ink/90 font-bold'
                  : 'bg-paper text-ink-muted border-hair-soft hover:bg-[rgba(11,13,14,0.03)] hover:text-ink'
              }`}
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Icon size={18} />
              )}
              <span className="text-sm font-medium">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Book Meeting section */}
      <div className="bg-paper border border-hair-soft rounded-xl overflow-hidden">
        <button
          onClick={() => setShowBookMeeting(!showBookMeeting)}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-[rgba(10,156,212,0.04)] transition-all"
        >
          <h3 className="text-ink text-sm font-bold flex items-center gap-2">
            <CalendarPlus size={16} className="text-sky-ink" />
            Book a Meeting
          </h3>
          {showBookMeeting ? (
            <ChevronUp size={16} className="text-ink-dim" />
          ) : (
            <ChevronDown size={16} className="text-ink-dim" />
          )}
        </button>

        {showBookMeeting && (
          <div className="px-6 pb-6 border-t border-hair-soft pt-4">
            {/* Their email */}
            <div className="mb-4">
              <label className="text-ink-dim text-xs font-medium block mb-1.5">
                Their Email
              </label>
              <input
                type="email"
                value={meetingEmail}
                onChange={(e) => setMeetingEmail(e.target.value)}
                placeholder="client@example.com"
                className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
              />
            </div>

            {/* Additional guests */}
            <div className="mb-4">
              <label className="text-ink-dim text-xs font-medium block mb-1.5 flex items-center gap-1">
                <UserPlus size={12} />
                Additional Guests
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="email"
                  placeholder="guest@example.com"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const input = e.currentTarget;
                      const email = input.value.trim();
                      if (email && email.includes('@')) {
                        setMeetingGuests((prev) => prev ? `${prev},${email}` : email);
                        input.value = '';
                      }
                    }
                  }}
                  className="flex-1 bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
                />
                <button
                  type="button"
                  onClick={() => {
                    const input = document.querySelector<HTMLInputElement>('[placeholder="guest@example.com"]');
                    if (input) {
                      const email = input.value.trim();
                      if (email && email.includes('@')) {
                        setMeetingGuests((prev) => prev ? `${prev},${email}` : email);
                        input.value = '';
                      }
                    }
                  }}
                  className="bg-tray border border-hair-soft rounded-lg px-3 py-2.5 text-ink-dim hover:text-ink-muted transition-all text-sm"
                >
                  Add
                </button>
              </div>
              {meetingGuests && (
                <div className="flex flex-wrap gap-2">
                  {meetingGuests.split(',').map((guest, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 bg-tray border border-hair-soft text-ink-muted text-xs px-2.5 py-1 rounded-full"
                    >
                      {guest}
                      <button
                        onClick={() => {
                          const guests = meetingGuests.split(',').filter((_, j) => j !== i);
                          setMeetingGuests(guests.join(','));
                        }}
                        className="text-ink-dim hover:text-ink transition-all"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Date, Time, Duration */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className="text-ink-dim text-xs font-medium block mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                  className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all [color-scheme:dark]"
                />
              </div>
              <div>
                <label className="text-ink-dim text-xs font-medium block mb-1.5">
                  Time
                </label>
                <input
                  type="time"
                  value={meetingTime}
                  onChange={(e) => setMeetingTime(e.target.value)}
                  className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all [color-scheme:dark]"
                />
              </div>
              <div>
                <label className="text-ink-dim text-xs font-medium block mb-1.5">
                  Duration
                </label>
                <select
                  value={meetingDuration}
                  onChange={(e) => setMeetingDuration(e.target.value)}
                  className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
                >
                  <option value="15">15 min</option>
                  <option value="30">30 min</option>
                  <option value="45">45 min</option>
                  <option value="60">1 hour</option>
                  <option value="90">1.5 hours</option>
                </select>
              </div>
            </div>

            {/* Timezone selector */}
            <div className="mb-4">
              <label className="text-ink-dim text-xs font-medium block mb-1.5">
                Timezone
              </label>
              <select
                value={meetingTimezone}
                onChange={(e) => setMeetingTimezone(e.target.value)}
                className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
              >
                <option value="Australia/Sydney">Sydney (AEST/AEDT)</option>
                <option value="Australia/Melbourne">Melbourne (AEST/AEDT)</option>
                <option value="Australia/Brisbane">Brisbane (AEST)</option>
                <option value="Australia/Adelaide">Adelaide (ACST/ACDT)</option>
                <option value="Australia/Perth">Perth (AWST)</option>
                <option value="Australia/Darwin">Darwin (ACST)</option>
                <option value="Australia/Hobart">Hobart (AEST/AEDT)</option>
              </select>
            </div>

            {/* Calendar events for selected day */}
            {meetingDate && calendarAuthenticated && (
              <div className="mb-4 bg-tray border border-hair-soft rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar size={12} className="text-ink-dim" />
                  <span className="text-ink-dim text-xs font-medium uppercase tracking-wider">
                    Your schedule for {meetingDate}
                  </span>
                </div>
                {loadingEvents ? (
                  <div className="flex items-center gap-2 text-ink-dim text-xs py-1">
                    <Loader2 size={12} className="animate-spin" />
                    Loading events...
                  </div>
                ) : dayEvents.length === 0 ? (
                  <p className="text-ink-dim text-xs py-1">No events scheduled</p>
                ) : (
                  <div className="space-y-1">
                    {dayEvents.map((event, i) => {
                      const startTime = event.startTime
                        ? new Date(event.startTime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
                        : '';
                      const endTime = event.endTime
                        ? new Date(event.endTime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
                        : '';
                      return (
                        <div key={i} className="text-xs text-ink-muted flex items-center gap-2">
                          <span className="text-ink-dim font-mono min-w-[90px]">
                            {startTime} - {endTime}
                          </span>
                          <span className="truncate">{event.summary}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Meeting type toggle */}
            <div className="mb-4">
              <label className="text-ink-dim text-xs font-medium block mb-2">
                Meeting Type
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setMeetingType('google_meet')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    meetingType === 'google_meet'
                      ? 'bg-[rgba(10,156,212,0.1)] border-[rgba(10,156,212,0.3)] text-sky-ink'
                      : 'bg-tray border-hair-soft text-ink-dim hover:text-ink-muted'
                  }`}
                >
                  <Video size={14} />
                  Google Meet
                </button>
                <button
                  onClick={() => setMeetingType('in_person')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    meetingType === 'in_person'
                      ? 'bg-[rgba(10,156,212,0.1)] border-[rgba(10,156,212,0.3)] text-sky-ink'
                      : 'bg-tray border-hair-soft text-ink-dim hover:text-ink-muted'
                  }`}
                >
                  <MapPin size={14} />
                  In Person
                </button>
              </div>
            </div>

            {/* Location (only for in-person) */}
            {meetingType === 'in_person' && (
              <div className="mb-4">
                <label className="text-ink-dim text-xs font-medium block mb-1.5">
                  Location / Address
                </label>
                <input
                  type="text"
                  value={meetingLocation}
                  onChange={(e) => setMeetingLocation(e.target.value)}
                  placeholder="e.g. 123 Collins St, Melbourne VIC 3000"
                  className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
                />
              </div>
            )}

            {/* Meeting notes */}
            <div className="mb-4">
              <label className="text-ink-dim text-xs font-medium block mb-1.5">
                Meeting Notes
              </label>
              <textarea
                value={meetingNotes}
                onChange={(e) => setMeetingNotes(e.target.value)}
                placeholder="What's the meeting about..."
                rows={2}
                className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all resize-none"
              />
            </div>

            {/* Google Calendar auth check */}
            {checkingAuth && (
              <div className="flex items-center gap-2 text-ink-muted text-sm mb-4">
                <Loader2 size={14} className="animate-spin" />
                Checking Google Calendar connection...
              </div>
            )}

            {calendarAuthenticated === false && !checkingAuth && (
              <button
                onClick={handleConnectGoogle}
                className="w-full bg-tray border border-hair-soft text-ink-muted rounded-lg px-5 py-3 text-sm hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all flex items-center justify-center gap-2 mb-4"
              >
                <ExternalLink size={14} />
                Connect Google Calendar
              </button>
            )}

            {/* Booking error */}
            {bookingError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-red-400 text-sm">{bookingError}</p>
              </div>
            )}

            {/* Booking success */}
            {bookingSuccess && (
              <div className="bg-[rgba(10,156,212,0.1)] border border-[rgba(10,156,212,0.2)] rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={16} className="text-sky-ink" />
                  <span className="text-sky-ink text-sm font-medium">Meeting booked</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <a
                    href={bookingSuccess.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-muted text-xs hover:text-ink flex items-center gap-1 transition-all"
                  >
                    <ExternalLink size={10} />
                    View in Google Calendar
                  </a>
                  {bookingSuccess.meetLink && (
                    <a
                      href={bookingSuccess.meetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink-muted text-xs hover:text-ink flex items-center gap-1 transition-all"
                    >
                      <Video size={10} />
                      Google Meet link
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Book Meeting button */}
            <button
              disabled={
                !meetingEmail ||
                !meetingDate ||
                !meetingTime ||
                bookingMeeting ||
                (meetingType === 'in_person' && !meetingLocation) ||
                calendarAuthenticated === false ||
                !!bookingSuccess
              }
              onClick={handleBookMeeting}
              className="w-full bg-ink text-white font-bold rounded-lg px-5 py-3 text-sm hover:bg-ink/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {bookingMeeting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CalendarPlus size={14} />
              )}
              {bookingSuccess ? 'Meeting Booked' : 'Book Meeting'}
            </button>
          </div>
        )}
      </div>

      {/* Voicemail modal removed — voicemail drafts now go to the Email Bank */}
    </div>
  );
}
