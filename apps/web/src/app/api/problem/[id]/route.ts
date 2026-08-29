import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mapToPublicScrapedProblemDTO, ScrapedProblem } from '@codeon/scrapers';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const problemRecord = await prisma.problem.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!problemRecord) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
    }

    const problemData = JSON.parse(problemRecord.data) as ScrapedProblem;
    const publicData = mapToPublicScrapedProblemDTO(problemData);

    return NextResponse.json(publicData);
  } catch (error: any) {
    console.error('Error fetching problem by ID:', error);
    return NextResponse.json({ error: 'Failed to fetch problem' }, { status: 500 });
  }
}
