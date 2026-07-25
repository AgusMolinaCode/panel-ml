import { NextRequest, NextResponse } from 'next/server';
import { getMonthlyExpenses, upsertMonthlyExpense } from '@/lib/db';

export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get('month');
  if (!month) {
    return NextResponse.json({ error: 'month param required' }, { status: 400 });
  }
  const expenses = getMonthlyExpenses(month);
  return NextResponse.json({ expenses });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (body.cloneFrom && body.cloneTo) {
    const sourceExpenses = getMonthlyExpenses(body.cloneFrom);
    for (const expense of sourceExpenses) {
      upsertMonthlyExpense({
        id: crypto.randomUUID(),
        month: body.cloneTo,
        concepto: expense.concepto,
        monto: expense.monto,
      });
    }
    return NextResponse.json({ success: true, cloned: sourceExpenses.length });
  }

  upsertMonthlyExpense(body);
  return NextResponse.json({ success: true });
}
