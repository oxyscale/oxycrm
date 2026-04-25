// ============================================================
// Book Meeting Page — standalone meeting booking from lead profile
// Creates a Google Calendar event with the lead as a guest
// ============================================================

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  CalendarPlus,
  Loader2,
  MapPin,
  Video,
  UserPlus,
  X,
  CheckCircle,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import * as api from '../services/api';
import type { Lead } from '../types';
import EyebrowLabel from '../components/ui/EyebrowLabel';

export default function BookMeetingPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();

  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  // Meeting form state
  const [meetingEmail, setMeetingEmail] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [meetingDuration, setMeetingDuration] = useState('30');
  const [meetingType, setMeetingType] = useState<'google_meet' | 'in_person'>('google_meet');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingGuests, setMeetingGuests] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  const [meetingTimezone, setMeetingTimezone] = useState('Australia/Sydney');

  // Calendar events for selected day
  const [dayEvents, setDayEvents] = useState<Array<{ summary: string; startTime: string; endTime: string }>>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Google Calendar auth
  const [calendarAuthenticated, setCalendarAuthenticated] = useState<boolean | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(false);

  // Booking state
  const [bookingMeeting, setBookingMeeting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<{
    htmlLink: string;
    meetLink?: string;
  } | null>(null);

  // Persist key for the in-flight booking form. Lead-scoped so two
  // different leads do not collide. Used to survive a same-tab OAuth
  // round-trip when the popup blocker forces it.
  const draftKey = leadId ? `book_meeting_v1_${leadId}` : null;

  // Load lead data. After the lead resolves, hydrate any saved draft so
  // we restore exactly what the user had typed before clicking Connect.
  useEffect(() => {
    if (!leadId) return;
    setLoading(true);
    api.getLeadById(parseInt(leadId, 10))
      .then((data) => {
        setLead(data);
        setMeetingEmail(data.email || '');
        if (draftKey) {
          try {
            const raw = window.sessionStorage.getItem(draftKey);
            if (raw) {
              const d = JSON.parse(raw) as Record<string, string>;
              if (d.email) setMeetingEmail(d.email);
              if (d.date) setMeetingDate(d.date);
              if (d.time) setMeetingTime(d.time);
              if (d.duration) setMeetingDuration(d.duration);
              if (d.type === 'google_meet' || d.type === 'in_person') setMeetingType(d.type);
              if (d.location) setMeetingLocation(d.location);
              if (d.guests) setMeetingGuests(d.guests);
              if (d.notes) setMeetingNotes(d.notes);
              if (d.timezone) setMeetingTimezone(d.timezone);
            }
          } catch { /* corrupt draft, ignore */ }
        }
      })
      .catch(() => navigate('/leads'))
      .finally(() => setLoading(false));
  }, [leadId, navigate, draftKey]);

  // Check Google Calendar auth on mount
  useEffect(() => {
    setCheckingAuth(true);
    api.getGoogleAuthStatus()
      .then(({ authenticated }) => setCalendarAuthenticated(authenticated))
      .catch(() => setCalendarAuthenticated(false))
      .finally(() => setCheckingAuth(false));
  }, []);

  // Fetch calendar events when meeting date changes
  useEffect(() => {
    if (!meetingDate || calendarAuthenticated !== true) {
      setDayEvents([]);
      return;
    }
    setLoadingEvents(true);
    api.getCalendarEvents(meetingDate, meetingTimezone)
      .then((events) => setDayEvents(events))
      .catch(() => setDayEvents([]))
      .finally(() => setLoadingEvents(false));
  }, [meetingDate, meetingTimezone, calendarAuthenticated]);

  const handleConnectGoogle = () => {
    // Stash the in-flight form so a same-tab fallback (popup blocker)
    // restores everything the user had typed when they land back here.
    if (draftKey) {
      try {
        window.sessionStorage.setItem(draftKey, JSON.stringify({
          email: meetingEmail,
          date: meetingDate,
          time: meetingTime,
          duration: meetingDuration,
          type: meetingType,
          location: meetingLocation,
          guests: meetingGuests,
          notes: meetingNotes,
          timezone: meetingTimezone,
        }));
      } catch { /* sessionStorage full / disabled — proceed anyway */ }
    }
    // Round-trip the current page so a same-tab fallback (popup blocker)
    // lands the user back on this booking screen, not on the home page.
    const returnTo = window.location.pathname + window.location.search;
    window.open(api.buildGoogleAuthUrl(returnTo), '_blank');
    // Poll to detect when auth completes. Force bypasses the server's
    // 5-min validity cache so we pick up the fresh tokens immediately.
    const pollInterval = setInterval(async () => {
      try {
        const { authenticated } = await api.getGoogleAuthStatus({ force: true });
        if (authenticated) {
          setCalendarAuthenticated(true);
          clearInterval(pollInterval);
        }
      } catch { /* ignore */ }
    }, 3000);
    setTimeout(() => clearInterval(pollInterval), 120_000);
  };

  const handleBookMeeting = async () => {
    if (!lead) return;
    setBookingMeeting(true);
    setBookingError(null);
    setBookingSuccess(null);

    try {
      const guestList = meetingGuests
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean);

      const result = await api.createCalendarEvent({
        summary: `Meeting with ${lead.name} - OxyScale`,
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
      // Booking succeeded — drop any stashed draft so the next visit
      // for this lead opens with a clean form.
      if (draftKey) {
        try { window.sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
      }
    } catch (err) {
      setBookingError(
        err instanceof Error ? err.message : 'Failed to book meeting. Please try again.'
      );
    } finally {
      setBookingMeeting(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-ink-dim" />
      </div>
    );
  }

  if (!lead) return null;

  return (
    <div className="h-full overflow-y-auto bg-cream">
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Header */}
        <button
          onClick={() => navigate(`/leads/${lead.id}`)}
          className="flex items-center gap-2 text-ink-dim hover:text-sky-ink text-sm mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to {lead.name}
        </button>

        <div className="mb-8">
          <EyebrowLabel variant="pill" className="mb-4">
            CALENDAR · BOOK
          </EyebrowLabel>
          <h1 className="text-[34px] font-semibold text-sky-ink tracking-section mb-1">
            Book a meeting.
          </h1>
          <p className="text-ink-muted text-sm">
            with {lead.name}{lead.company ? ` at ${lead.company}` : ''}
          </p>
        </div>

        {/* Google Calendar auth check */}
        {checkingAuth && (
          <div className="flex items-center gap-2 text-ink-muted text-sm mb-6">
            <Loader2 size={14} className="animate-spin" />
            Checking Google Calendar connection...
          </div>
        )}

        {calendarAuthenticated === false && !checkingAuth && (
          <div className="bg-paper border border-hair-soft rounded-xl p-6 mb-6">
            <p className="text-ink-muted text-sm mb-4">
              Connect your Google Calendar to book meetings and see your schedule.
            </p>
            <button
              onClick={handleConnectGoogle}
              className="bg-tray border border-hair-soft text-ink-muted rounded-lg px-5 py-3 text-sm hover:bg-[rgba(11,13,14,0.03)] hover:text-ink transition-all flex items-center gap-2"
            >
              <ExternalLink size={14} />
              Connect Google Calendar
            </button>
          </div>
        )}

        {/* Meeting form */}
        <div className="bg-paper border border-hair-soft rounded-xl p-6 space-y-5">
          {/* Their email */}
          <div>
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
          <div>
            <label className="text-ink-dim text-xs font-medium block mb-1.5 flex items-center gap-1">
              <UserPlus size={12} />
              Additional Guests
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="email"
                id="guest-email-input"
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
                  const input = document.getElementById('guest-email-input') as HTMLInputElement;
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
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-ink-dim text-xs font-medium block mb-1.5">Date</label>
              <input
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="text-ink-dim text-xs font-medium block mb-1.5">Time</label>
              <input
                type="time"
                value={meetingTime}
                onChange={(e) => setMeetingTime(e.target.value)}
                className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="text-ink-dim text-xs font-medium block mb-1.5">Duration</label>
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

          {/* Timezone */}
          <div>
            <label className="text-ink-dim text-xs font-medium block mb-1.5">Timezone</label>
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
            <div className="bg-tray border border-hair-soft rounded-lg p-3">
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
          <div>
            <label className="text-ink-dim text-xs font-medium block mb-2">Meeting Type</label>
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

          {/* Location (in-person only) */}
          {meetingType === 'in_person' && (
            <div>
              <label className="text-ink-dim text-xs font-medium block mb-1.5">Location / Address</label>
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
          <div>
            <label className="text-ink-dim text-xs font-medium block mb-1.5">Meeting Notes</label>
            <textarea
              value={meetingNotes}
              onChange={(e) => setMeetingNotes(e.target.value)}
              placeholder="What's the meeting about..."
              rows={2}
              className="w-full bg-tray border border-hair-soft rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all resize-none"
            />
          </div>

          {/* Booking error */}
          {bookingError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-red-400 text-sm">{bookingError}</p>
            </div>
          )}

          {/* Booking success */}
          {bookingSuccess && (
            <div className="bg-[rgba(10,156,212,0.1)] border border-[rgba(10,156,212,0.2)] rounded-lg p-4">
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
      </div>
    </div>
  );
}
