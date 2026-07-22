'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { attendance, notes } from '@/db/schema';
import { auth } from '@/auth';

async function requireAuth() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
}

/** Mark whether Sam intends to go (drives the Google Calendar push). */
export async function setGoing(eventId: string, going: boolean) {
  await requireAuth();
  await db
    .insert(attendance)
    .values({ eventId, going, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: attendance.eventId,
      set: { going, updatedAt: new Date() },
    });
  revalidatePath('/');
}

/**
 * The after-the-fact tick (true) / cross (false) / clear (null).
 * This is the signal that feeds back into the next run's curation.
 */
export async function setAttended(eventId: string, attended: boolean | null) {
  await requireAuth();
  await db
    .insert(attendance)
    .values({ eventId, attended, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: attendance.eventId,
      set: { attended, updatedAt: new Date() },
    });
  revalidatePath('/');
}

export async function addNote(eventId: string, body: string) {
  await requireAuth();
  const trimmed = body.trim();
  if (!trimmed) return;
  await db.insert(notes).values({ eventId, body: trimmed });
  revalidatePath('/');
}

export async function deleteNote(noteId: string) {
  await requireAuth();
  await db.delete(notes).where(eq(notes.id, noteId));
  revalidatePath('/');
}
