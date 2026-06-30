import { type Database } from "@tursodatabase/database";

export interface MemoryRecord {
  id: number;
  jid: string;
  content: string;
  tags: string[];
  createdAt: string;
}

export interface MemorySearchResult extends MemoryRecord {
  distance: number;
}

export interface MemoriesLocalResource {
  insert: (jid: string, content: string, tags: string[], embedding: number[]) => Promise<number>;
  searchFull: (jid: string, embedding: number[], limit?: number, tags?: string[]) => Promise<MemorySearchResult[]>;
  delete: (jid: string, id: number) => Promise<boolean>;
}

export const createMemoriesLocalResource = (db: Database): MemoriesLocalResource => {
  return {
    insert: async (jid, content, tags, embedding) => {
      const tagsJson = JSON.stringify(tags);
      const embeddingStr = JSON.stringify(embedding);

      const insertStmt = await db.prepare("INSERT INTO memories (jid, content, tags, embedding) VALUES (?, ?, ?, vector(?))");
      const info = await insertStmt.run(jid, content, tagsJson, embeddingStr);
      return info.lastInsertRowid;
    },
    delete: async (jid, id) => {
      const deleteStmt = await db.prepare("DELETE FROM memories WHERE id = ? AND jid = ?");
      const info = await deleteStmt.run(id, jid);
      return info.changes > 0;
    },
    searchFull: async (jid, embedding, limit = 10, tags) => {
      const embeddingStr = JSON.stringify(embedding);
      let baseSql = `
        SELECT 
          id, jid, content, tags, created_at as createdAt, 
          vector_distance_cos(embedding, vector(?)) as distance
        FROM memories
        WHERE jid = ?
      `;
      const params: unknown[] = [embeddingStr, jid];

      if (tags && tags.length > 0) {
        baseSql += ` AND EXISTS (SELECT 1 FROM json_each(memories.tags) WHERE value IN (${tags.map(() => "?").join(", ")}))`;
        params.push(...tags);
      }

      baseSql += ` ORDER BY distance ASC LIMIT ?`;
      params.push(limit);

      const searchStmt = await db.prepare(baseSql);
      const results = (await searchStmt.all(...params)) as Array<{
        id: number;
        jid: string;
        content: string;
        tags: string;
        createdAt: string;
        distance: number;
      }>;

      return results.map((row) => ({
        id: row.id,
        jid: row.jid,
        content: row.content,
        tags: JSON.parse(row.tags) as string[],
        createdAt: row.createdAt,
        distance: row.distance,
      }));
    },
  };
};
