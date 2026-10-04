/** Calendar dates only: Sunday release means the following Sunday, not today. */
export function demoDeadlines(releaseDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())) {
    const released = new Date(`${releaseDate}T00:00:00Z`);
    if (Number.isNaN(released.getTime())) throw new Error('Invalid fixture release date');
    const due = new Date(released);
    due.setUTCDate(due.getUTCDate() + (7 - due.getUTCDay()));
    const extended = new Date(due);
    extended.setUTCDate(extended.getUTCDate() + 7);
    const format = date => new Intl.DateTimeFormat('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(date);
    return { releaseDate, released: format(released), original: format(due), extended: format(extended) };
}
